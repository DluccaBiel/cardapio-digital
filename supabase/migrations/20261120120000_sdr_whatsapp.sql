-- ============================================================================
-- 20261120120000_sdr_whatsapp.sql — SDR no WhatsApp (extensão + robô + IA)
-- Pré-requisitos: até 20261119120000. BACKUP antes de aplicar em produção.
--
--   prospect_leads      + funil (stage), valor previsto, responsável, qualificação,
--                       pausa da IA / pedido de humano, últimas mensagens, checagem do WhatsApp
--   sdr_settings        regras do workspace: janela de envio, limites, IA, prospecção, reuniões
--   sdr_messages        histórico das conversas com LEADS (nunca contatos pessoais) [PII/LGPD]
--   sdr_tasks           fila de envio do robô (primeiro contato, follow-up, resposta da IA, manual)
--   sdr_cadences        follow-up por etapa (passos com espera em horas)
--   sdr_enrollments     lead dentro de uma cadência (próximo passo / parada)
--   sdr_notes           notas e lembretes por lead
--   sdr_quick_replies   respostas rápidas por etapa (com {nome})
--   extensions          + catálogo 'undercut-sdr'
--
-- Aditiva: só cria tabelas/colunas e amplia um CHECK. RLS em todas as tabelas novas.
-- O robô local e a API das extensões usam service role (sempre filtrando workspace_id).
-- ============================================================================

-- 1) Lead: funil e estado da conversa -------------------------------------------
alter table public.prospect_leads add column if not exists stage            text not null default 'novo';
alter table public.prospect_leads add column if not exists deal_value       numeric(12,2);
alter table public.prospect_leads add column if not exists owner_id         uuid references auth.users(id) on delete set null;
alter table public.prospect_leads add column if not exists score            smallint;
alter table public.prospect_leads add column if not exists qualification    jsonb not null default '{}'::jsonb;
alter table public.prospect_leads add column if not exists ai_paused        boolean not null default false;
alter table public.prospect_leads add column if not exists needs_human      boolean not null default false;
alter table public.prospect_leads add column if not exists handoff_reason   text;
alter table public.prospect_leads add column if not exists last_inbound_at  timestamptz;
alter table public.prospect_leads add column if not exists last_outbound_at timestamptz;
alter table public.prospect_leads add column if not exists wa_exists        boolean;
alter table public.prospect_leads add column if not exists wa_checked_at    timestamptz;
alter table public.prospect_leads add column if not exists meeting_at       timestamptz;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'prospect_leads_stage_check') then
        alter table public.prospect_leads add constraint prospect_leads_stage_check
            check (stage in ('novo', 'contatado', 'respondeu', 'qualificado', 'reuniao', 'proposta', 'cliente', 'perdido'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'prospect_leads_score_check') then
        alter table public.prospect_leads add constraint prospect_leads_score_check check (score is null or score between 0 and 100);
    end if;
    -- origem: + whatsapp (lead criado pela extensão a partir de uma conversa)
    alter table public.prospect_leads drop constraint if exists prospect_leads_source_check;
    alter table public.prospect_leads add constraint prospect_leads_source_check check (source in ('osm', 'manual', 'whatsapp'));
end $$;

create index if not exists idx_prospect_leads_ws_stage on public.prospect_leads (workspace_id, stage);
create index if not exists idx_prospect_leads_needs_human on public.prospect_leads (workspace_id) where needs_human;
create index if not exists idx_prospect_leads_owner on public.prospect_leads (owner_id);
comment on column public.prospect_leads.stage is 'Funil do SDR: novo → contatado → respondeu → qualificado → reuniao → proposta → cliente | perdido.';
comment on column public.prospect_leads.ai_paused is 'true = um humano assumiu a conversa; a IA não responde este lead.';

-- 2) Configuração do SDR (1 linha por workspace) --------------------------------
create table if not exists public.sdr_settings (
    workspace_id                 uuid primary key references public.workspaces(id) on delete cascade,
    -- Mensagens INICIADAS por nós (primeiro contato / follow-up): janela em America/Sao_Paulo
    outreach_days                smallint[] not null default '{1,2,3,4,5,6}' check (outreach_days <@ array[0,1,2,3,4,5,6]::smallint[]),
    outreach_start               time not null default '09:00',
    outreach_end                 time not null default '20:00',
    daily_new_contacts           integer not null default 50 check (daily_new_contacts between 0 and 300),
    interval_min_seconds         integer not null default 60 check (interval_min_seconds >= 20),
    interval_max_seconds         integer not null default 180 check (interval_max_seconds <= 3600),
    -- IA (responde 24h quem escreveu primeiro)
    ai_enabled                   boolean not null default false,
    ai_mode                      text not null default 'auto' check (ai_mode in ('suggest', 'auto')),
    ai_max_replies_per_lead_day  integer not null default 12 check (ai_max_replies_per_lead_day between 1 and 100),
    ai_reply_delay_seconds       integer not null default 45 check (ai_reply_delay_seconds between 0 and 900),
    playbook                     text not null default '',
    prices                       text not null default '',
    forbidden                    text not null default '',
    -- Prospecção contínua (agente busca empresas novas e coloca no funil)
    prospect_enabled             boolean not null default false,
    prospect_cities              jsonb not null default '[]'::jsonb,
    prospect_every_hours         integer not null default 24 check (prospect_every_hours between 1 and 168),
    first_contact_cadence_id     uuid,
    -- Reuniões (Google Agenda, Parte 4)
    meeting_minutes              integer not null default 30 check (meeting_minutes between 10 and 180),
    meeting_days                 smallint[] not null default '{1,2,3,4,5}' check (meeting_days <@ array[0,1,2,3,4,5,6]::smallint[]),
    meeting_start                time not null default '10:00',
    meeting_end                  time not null default '17:00',
    stage_labels                 jsonb not null default '{}'::jsonb,
    created_at                   timestamptz not null default now(),
    updated_at                   timestamptz not null default now(),
    check (interval_max_seconds >= interval_min_seconds),
    check (outreach_end > outreach_start),
    check (meeting_end > meeting_start)
);
comment on table public.sdr_settings is 'Regras do SDR no WhatsApp por workspace (janela/limites de envio, IA, prospecção contínua, reuniões).';

-- 3) Mensagens (só de leads) -----------------------------------------------------
create table if not exists public.sdr_messages (
    id             uuid primary key default gen_random_uuid(),
    workspace_id   uuid not null references public.workspaces(id) on delete cascade,
    lead_id        uuid not null,
    direction      text not null check (direction in ('in', 'out')),
    body           text not null check (char_length(body) <= 4000),          -- [PII/LGPD]
    sent_by        text not null check (sent_by in ('lead', 'human', 'ai', 'cadence', 'system')),
    wa_message_id  text,
    task_id        uuid,
    created_at     timestamptz not null default now(),
    unique (workspace_id, wa_message_id),
    foreign key (workspace_id, lead_id) references public.prospect_leads (workspace_id, id) on delete cascade
);
comment on table public.sdr_messages is 'Histórico de conversas com LEADS do SDR (nunca contatos pessoais/grupos). Retenção: 12 meses. [PII/LGPD]';
create index if not exists idx_sdr_messages_lead on public.sdr_messages (lead_id, created_at desc);
create index if not exists idx_sdr_messages_ws_created on public.sdr_messages (workspace_id, created_at desc);

-- 4) Cadências (follow-up por etapa) ---------------------------------------------
create table if not exists public.sdr_cadences (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    name          text not null check (char_length(name) between 1 and 120),
    stage         text not null check (stage in ('novo', 'contatado', 'respondeu', 'qualificado', 'reuniao', 'proposta')),
    active        boolean not null default true,
    -- [{ "wait_hours": 0, "body": "Olá, {nome}! ..." }, { "wait_hours": 24, "body": "..." }]
    steps         jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (workspace_id, id)
);
create index if not exists idx_sdr_cadences_ws on public.sdr_cadences (workspace_id, stage) where active;

create table if not exists public.sdr_enrollments (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    lead_id       uuid not null,
    cadence_id    uuid not null,
    step_index    integer not null default 0,
    next_run_at   timestamptz,
    status        text not null default 'ativa' check (status in ('ativa', 'concluida', 'parada')),
    stop_reason   text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    foreign key (workspace_id, lead_id) references public.prospect_leads (workspace_id, id) on delete cascade,
    foreign key (workspace_id, cadence_id) references public.sdr_cadences (workspace_id, id) on delete cascade
);
create unique index if not exists uq_sdr_enrollments_active on public.sdr_enrollments (lead_id) where status = 'ativa';
create index if not exists idx_sdr_enrollments_due on public.sdr_enrollments (workspace_id, next_run_at) where status = 'ativa';
create index if not exists idx_sdr_enrollments_cadence on public.sdr_enrollments (cadence_id);

-- 5) Fila de envio do robô --------------------------------------------------------
create table if not exists public.sdr_tasks (
    id                uuid primary key default gen_random_uuid(),
    workspace_id      uuid not null references public.workspaces(id) on delete cascade,
    lead_id           uuid not null,
    kind              text not null check (kind in ('first_contact', 'follow_up', 'ai_reply', 'manual', 'away')),
    body              text not null check (char_length(body) between 1 and 4000),
    status            text not null default 'pendente'
                      check (status in ('aguardando_aprovacao', 'pendente', 'enviando', 'enviada', 'falhou', 'cancelada')),
    scheduled_at      timestamptz not null default now(),
    -- true = só sai dentro da janela de envio (mensagens que NÓS iniciamos); respostas = false (24h)
    respects_window   boolean not null default true,
    enrollment_id     uuid references public.sdr_enrollments(id) on delete set null,
    attempts          integer not null default 0,
    error             text,
    sent_at           timestamptz,
    created_by        uuid references auth.users(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    foreign key (workspace_id, lead_id) references public.prospect_leads (workspace_id, id) on delete cascade
);
create index if not exists idx_sdr_tasks_queue on public.sdr_tasks (workspace_id, status, scheduled_at);
create index if not exists idx_sdr_tasks_lead on public.sdr_tasks (lead_id, created_at desc);
create index if not exists idx_sdr_tasks_enrollment on public.sdr_tasks (enrollment_id);
create index if not exists idx_sdr_tasks_created_by on public.sdr_tasks (created_by);

-- 6) Notas / lembretes e respostas rápidas ---------------------------------------
create table if not exists public.sdr_notes (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    lead_id       uuid not null,
    body          text not null check (char_length(body) between 1 and 2000),
    remind_at     timestamptz,
    done          boolean not null default false,
    created_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    foreign key (workspace_id, lead_id) references public.prospect_leads (workspace_id, id) on delete cascade
);
create index if not exists idx_sdr_notes_lead on public.sdr_notes (lead_id, created_at desc);
create index if not exists idx_sdr_notes_remind on public.sdr_notes (workspace_id, remind_at) where not done and remind_at is not null;
create index if not exists idx_sdr_notes_created_by on public.sdr_notes (created_by);

create table if not exists public.sdr_quick_replies (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    stage         text check (stage is null or stage in ('novo', 'contatado', 'respondeu', 'qualificado', 'reuniao', 'proposta', 'cliente', 'perdido')),
    title         text not null check (char_length(title) between 1 and 80),
    body          text not null check (char_length(body) between 1 and 2000),
    sort_order    integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists idx_sdr_quick_replies_ws on public.sdr_quick_replies (workspace_id, stage, sort_order);

-- updated_at ------------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['sdr_settings', 'sdr_cadences', 'sdr_enrollments', 'sdr_tasks', 'sdr_notes', 'sdr_quick_replies'] loop
        execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
        execute format('create trigger trg_%1$s_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
    end loop;
end $$;

-- RLS ---------------------------------------------------------------------------------
-- Membros leem; dono/coordenador/editor operam o SDR (mensagens, tarefas, notas, cadências,
-- respostas rápidas); configurações só dono/coordenador.
do $$
declare t text;
begin
    foreach t in array array['sdr_settings', 'sdr_messages', 'sdr_cadences', 'sdr_enrollments', 'sdr_tasks', 'sdr_notes', 'sdr_quick_replies'] loop
        execute format('alter table public.%1$s enable row level security', t);
        execute format('revoke all on public.%1$s from anon', t);
        execute format('drop policy if exists %1$s_select on public.%1$s', t);
        execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_workspace_member(workspace_id))', t);
    end loop;

    foreach t in array array['sdr_messages', 'sdr_cadences', 'sdr_enrollments', 'sdr_tasks', 'sdr_notes', 'sdr_quick_replies'] loop
        execute format('drop policy if exists %1$s_insert on public.%1$s', t);
        execute format($p$create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))$p$, t);
        execute format('drop policy if exists %1$s_update on public.%1$s', t);
        execute format($p$create policy %1$s_update on public.%1$s for update to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[])) with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))$p$, t);
        execute format('drop policy if exists %1$s_delete on public.%1$s', t);
        execute format($p$create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))$p$, t);
    end loop;
end $$;

drop policy if exists sdr_settings_insert on public.sdr_settings;
create policy sdr_settings_insert on public.sdr_settings
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists sdr_settings_update on public.sdr_settings;
create policy sdr_settings_update on public.sdr_settings
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

-- Editor também move leads no funil (antes só dono/coordenador alteravam prospect_leads).
drop policy if exists prospect_leads_update on public.prospect_leads;
create policy prospect_leads_update on public.prospect_leads
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- 7) Catálogo da extensão -------------------------------------------------------------
insert into public.extensions (slug, name, description, homepage_url)
values (
    'undercut-sdr',
    'Undercut · SDR WhatsApp',
    'Painel do SDR dentro do WhatsApp Web: ficha e funil do lead, notas e lembretes, respostas rápidas, atalhos # e respostas da IA.',
    null
)
on conflict (slug) do nothing;
