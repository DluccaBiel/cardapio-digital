-- ============================================================================
-- 20261118120000_whatsapp_disparos.sql — Disparos WhatsApp (conexão por QR) + público da IA
-- Pré-requisitos: 0001..0010 + 20261116152908 + 20261116210000. BACKUP antes de aplicar em produção.
--
--   1) whatsapp_sessions     estado da conexão (QR/vinculado/sincronização) por workspace.
--                            O robô local (apps/whatsapp-worker, service role) escreve o
--                            status; o painel só altera `desired_state` (grant por coluna).
--   2) prospect_searches     pedidos de pesquisa do agente (o robô local executa, sem limite de tempo).
--      prospect_leads        empresas encontradas pelo agente de prospecção (OpenStreetMap).
--                            Únicas por telefone dentro do workspace.
--   3) broadcast_campaigns   mensagem + agenda (dias/horário) + intervalo entre envios + limite diário.
--   4) broadcast_recipients  público de cada disparo (fila de envio).
--
-- Aditiva: só cria tabelas. RLS em todas.
-- ============================================================================

-- 1) Sessão do WhatsApp -----------------------------------------------------------
create table if not exists public.whatsapp_sessions (
    workspace_id    uuid primary key references public.workspaces(id) on delete cascade,
    desired_state   text not null default 'disconnected' check (desired_state in ('connected', 'disconnected')),
    status          text not null default 'disconnected'
                    check (status in ('disconnected', 'starting', 'qr', 'connecting', 'syncing', 'ready', 'logged_out', 'error')),
    qr_data_url     text,                                     -- QR temporário (expira em ~20 s); apagado ao vincular
    qr_updated_at   timestamptz,
    phone           text,                                     -- [PII/LGPD] número vinculado
    display_name    text,                                     -- [PII/LGPD] nome do perfil
    sync_progress   integer check (sync_progress between 0 and 100),
    sync_detail     text,
    last_error      text,                                     -- sem dados sensíveis
    worker_seen_at  timestamptz,                              -- batimento do robô local
    connected_at    timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
comment on table public.whatsapp_sessions is 'Conexão WhatsApp (não oficial, por QR) do workspace. Status escrito pelo robô local (service role); painel só altera desired_state.';

-- 2) Pesquisas do agente de prospecção (fila processada pelo robô local) -------------
create table if not exists public.prospect_searches (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references public.workspaces(id) on delete cascade,
    niche           text not null default 'food' check (niche in ('food', 'health')),
    city            text not null check (char_length(city) between 2 and 80),
    uf              text check (uf is null or uf ~ '^[A-Z]{2}$'),
    status          text not null default 'pendente' check (status in ('pendente', 'buscando', 'concluida', 'erro')),
    label           text,
    found           integer not null default 0,
    created_count   integer not null default 0,
    detail          text,
    created_by      uuid references auth.users(id) on delete set null,
    started_at      timestamptz,
    finished_at     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (workspace_id, id)
);
comment on table public.prospect_searches is 'Pedido de pesquisa de empresas (cidade/nicho). O robô local executa (sem limite de tempo) e grava os leads com search_id.';
create index if not exists idx_prospect_searches_queue on public.prospect_searches (workspace_id, status, created_at);
create index if not exists idx_prospect_searches_created_by on public.prospect_searches (created_by);

-- 2b) Leads da prospecção -------------------------------------------------------------
create table if not exists public.prospect_leads (
    id                 uuid primary key default gen_random_uuid(),
    workspace_id       uuid not null references public.workspaces(id) on delete cascade,
    source             text not null default 'osm' check (source in ('osm', 'manual')),
    external_id        text,                                  -- ex.: node/123 (OpenStreetMap)
    name               text not null check (char_length(name) between 1 and 200),
    phone              text not null check (phone ~ '^\d{10,15}$'),  -- [PII/LGPD] só dígitos, com DDI
    niche              text not null default 'food' check (niche in ('food', 'health')),
    category           text,
    city               text,
    uf                 text check (uf is null or uf ~ '^[A-Z]{2}$'),
    address            text,
    website            text,
    search_id          uuid,                                  -- pesquisa que encontrou o lead
    status             text not null default 'novo'
                       check (status in ('novo', 'na_fila', 'contatado', 'respondeu', 'opt_out', 'invalido')),
    last_contacted_at  timestamptz,
    found_at           timestamptz not null default now(),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (workspace_id, phone),
    unique (workspace_id, id),
    foreign key (workspace_id, search_id) references public.prospect_searches (workspace_id, id) on delete set null (search_id)
);
create index if not exists idx_prospect_leads_search on public.prospect_leads (search_id);
comment on table public.prospect_leads is 'Empresas encontradas pelo agente de prospecção (dados abertos do OpenStreetMap). opt_out = pediu para não receber mensagens (LGPD).';
create index if not exists idx_prospect_leads_ws_status on public.prospect_leads (workspace_id, status);

-- 3) Campanhas de disparo -------------------------------------------------------------
create table if not exists public.broadcast_campaigns (
    id                    uuid primary key default gen_random_uuid(),
    workspace_id          uuid not null references public.workspaces(id) on delete cascade,
    name                  text not null check (char_length(name) between 1 and 120),
    message               text not null check (char_length(message) between 1 and 2000),
    status                text not null default 'agendada'
                          check (status in ('agendada', 'enviando', 'pausada', 'concluida', 'cancelada')),
    start_date            date not null,
    days_of_week          smallint[] not null check (cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
    window_start          time not null,
    window_end            time not null,
    interval_min_seconds  integer not null check (interval_min_seconds >= 20),
    interval_max_seconds  integer not null check (interval_max_seconds <= 3600),
    daily_limit           integer not null default 40 check (daily_limit between 1 and 300),
    total                 integer not null default 0,
    sent_count            integer not null default 0,
    failed_count          integer not null default 0,
    next_send_at          timestamptz,
    last_error            text,
    created_by            uuid references auth.users(id) on delete set null,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    check (interval_max_seconds >= interval_min_seconds),
    check (window_end > window_start),
    unique (workspace_id, id)
);
comment on table public.broadcast_campaigns is 'Disparo agendado: dias da semana (0=domingo) e janela de horário em America/Sao_Paulo; intervalo aleatório entre min e max segundos.';
create index if not exists idx_broadcast_campaigns_ws_status on public.broadcast_campaigns (workspace_id, status);
create index if not exists idx_broadcast_campaigns_created_by on public.broadcast_campaigns (created_by);

-- 4) Destinatários -------------------------------------------------------------------
create table if not exists public.broadcast_recipients (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    campaign_id   uuid not null,
    lead_id       uuid,
    name          text not null,
    phone         text not null check (phone ~ '^\d{10,15}$'),  -- [PII/LGPD]
    status        text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'ignorado')),
    error         text,
    sent_at       timestamptz,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (campaign_id, phone),
    foreign key (workspace_id, campaign_id) references public.broadcast_campaigns (workspace_id, id) on delete cascade,
    foreign key (workspace_id, lead_id) references public.prospect_leads (workspace_id, id) on delete set null (lead_id)
);
create index if not exists idx_broadcast_recipients_queue on public.broadcast_recipients (campaign_id, status, created_at);
create index if not exists idx_broadcast_recipients_ws_sent on public.broadcast_recipients (workspace_id, sent_at);
create index if not exists idx_broadcast_recipients_lead on public.broadcast_recipients (lead_id);

-- updated_at --------------------------------------------------------------------------
drop trigger if exists trg_whatsapp_sessions_updated_at on public.whatsapp_sessions;
create trigger trg_whatsapp_sessions_updated_at before update on public.whatsapp_sessions for each row execute function public.set_updated_at();
drop trigger if exists trg_prospect_searches_updated_at on public.prospect_searches;
create trigger trg_prospect_searches_updated_at before update on public.prospect_searches for each row execute function public.set_updated_at();
drop trigger if exists trg_prospect_leads_updated_at on public.prospect_leads;
create trigger trg_prospect_leads_updated_at before update on public.prospect_leads for each row execute function public.set_updated_at();
drop trigger if exists trg_broadcast_campaigns_updated_at on public.broadcast_campaigns;
create trigger trg_broadcast_campaigns_updated_at before update on public.broadcast_campaigns for each row execute function public.set_updated_at();
drop trigger if exists trg_broadcast_recipients_updated_at on public.broadcast_recipients;
create trigger trg_broadcast_recipients_updated_at before update on public.broadcast_recipients for each row execute function public.set_updated_at();

-- RLS ---------------------------------------------------------------------------------
alter table public.whatsapp_sessions     enable row level security;
alter table public.prospect_searches     enable row level security;
alter table public.prospect_leads        enable row level security;
alter table public.broadcast_campaigns   enable row level security;
alter table public.broadcast_recipients  enable row level security;

-- whatsapp_sessions: dono/coordenador leem e pedem conectar/desconectar (só desired_state).
drop policy if exists whatsapp_sessions_select on public.whatsapp_sessions;
create policy whatsapp_sessions_select on public.whatsapp_sessions
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists whatsapp_sessions_insert on public.whatsapp_sessions;
create policy whatsapp_sessions_insert on public.whatsapp_sessions
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists whatsapp_sessions_update on public.whatsapp_sessions;
create policy whatsapp_sessions_update on public.whatsapp_sessions
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
revoke insert, update, delete on public.whatsapp_sessions from anon, authenticated;
grant insert (workspace_id, desired_state) on public.whatsapp_sessions to authenticated;
grant update (desired_state) on public.whatsapp_sessions to authenticated;

-- Demais tabelas: membros leem; dono/coordenador escrevem.
do $$
declare t text;
begin
    foreach t in array array['prospect_searches', 'prospect_leads', 'broadcast_campaigns', 'broadcast_recipients'] loop
        execute format('drop policy if exists %1$s_select on public.%1$s', t);
        execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_workspace_member(workspace_id))', t);
        execute format('drop policy if exists %1$s_insert on public.%1$s', t);
        execute format($p$create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))$p$, t);
        execute format('drop policy if exists %1$s_update on public.%1$s', t);
        execute format($p$create policy %1$s_update on public.%1$s for update to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[])) with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))$p$, t);
        execute format('drop policy if exists %1$s_delete on public.%1$s', t);
        execute format($p$create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))$p$, t);
        execute format('revoke all on public.%1$s from anon', t);
    end loop;
end $$;
