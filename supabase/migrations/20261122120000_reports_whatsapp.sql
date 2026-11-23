-- ============================================================================
-- 20261122120000_reports_whatsapp.sql — Relatórios enviados nos grupos do WhatsApp
-- Pré-requisitos: até 20261120130000. BACKUP antes de aplicar em produção.
--
--   whatsapp_groups      grupos do número conectado (o robô local lista e grava)
--   whatsapp_sessions    + pedido/hora da última leitura de grupos (painel pede, robô executa)
--   report_targets       1 por conta de anúncio: grupo do cliente, juntar/separar campanhas,
--                        campanhas escolhidas
--   report_settings      modelo do workspace (blocos, período, intervalo entre envios)
--   report_schedules     disparo automático (dias, hora, período, contas, intervalo)
--   reports              histórico: cada relatório gerado (métricas, mensagem, status do envio)
--   ad_accounts          + unique (workspace_id, id) para FKs compostas (tenant consistency)
-- ============================================================================

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'uq_ad_accounts_ws_id') then
        alter table public.ad_accounts add constraint uq_ad_accounts_ws_id unique (workspace_id, id);
    end if;
end $$;

-- 1) Grupos do WhatsApp ----------------------------------------------------------
create table if not exists public.whatsapp_groups (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    jid           text not null check (jid ~ '^[0-9-]+@g\.us$'),
    name          text not null default '',                 -- [PII/LGPD] nome do grupo
    participants  integer not null default 0,
    synced_at     timestamptz not null default now(),
    created_at    timestamptz not null default now(),
    unique (workspace_id, jid)
);
create index if not exists idx_whatsapp_groups_ws on public.whatsapp_groups (workspace_id, name);

alter table public.whatsapp_sessions add column if not exists groups_sync_requested_at timestamptz;
alter table public.whatsapp_sessions add column if not exists groups_synced_at timestamptz;
grant update (groups_sync_requested_at) on public.whatsapp_sessions to authenticated;

-- 2) Configuração por conta de anúncio ---------------------------------------------
create table if not exists public.report_targets (
    id             uuid primary key default gen_random_uuid(),
    workspace_id   uuid not null references public.workspaces(id) on delete cascade,
    ad_account_id  uuid not null,
    group_jid      text check (group_jid is null or group_jid ~ '^[0-9-]+@g\.us$'),
    group_name     text,
    campaign_mode  text not null default 'merged' check (campaign_mode in ('merged', 'separate')),
    campaign_ids   text[] not null default '{}',             -- vazio = todas as campanhas com gasto no período
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (workspace_id, ad_account_id),
    unique (workspace_id, id),
    foreign key (workspace_id, ad_account_id) references public.ad_accounts (workspace_id, id) on delete cascade
);
comment on table public.report_targets is 'Relatório por conta de anúncio: grupo do WhatsApp do cliente e campanhas (juntas ou separadas).';

create table if not exists public.report_settings (
    workspace_id          uuid primary key references public.workspaces(id) on delete cascade,
    blocks                jsonb not null default '{"general": true, "byObjective": true, "topCreatives": true, "balance": true}'::jsonb,
    period_key            text not null default 'last' check (period_key in ('last', '7d', '14d', '30d', 'month', 'lastMonth', 'yesterday')),
    compare               boolean not null default true,
    interval_min_seconds  integer not null default 60 check (interval_min_seconds >= 20),
    interval_max_seconds  integer not null default 180 check (interval_max_seconds <= 3600),
    updated_at            timestamptz not null default now(),
    check (interval_max_seconds >= interval_min_seconds)
);

-- 3) Agendamentos --------------------------------------------------------------------
create table if not exists public.report_schedules (
    id                    uuid primary key default gen_random_uuid(),
    workspace_id          uuid not null references public.workspaces(id) on delete cascade,
    name                  text not null check (char_length(name) between 1 and 120),
    active                boolean not null default true,
    days_of_week          smallint[] not null check (cardinality(days_of_week) between 1 and 7 and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
    send_time             time not null,
    period_key            text not null default 'last' check (period_key in ('last', '7d', '14d', '30d', 'month', 'lastMonth', 'yesterday')),
    compare               boolean not null default true,
    target_ids            uuid[] not null check (cardinality(target_ids) between 1 and 500),
    interval_min_seconds  integer not null default 60 check (interval_min_seconds >= 20),
    interval_max_seconds  integer not null default 180 check (interval_max_seconds <= 3600),
    next_run_at           timestamptz,
    last_run_at           timestamptz,
    last_error            text,
    created_by            uuid references auth.users(id) on delete set null,
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    check (interval_max_seconds >= interval_min_seconds),
    unique (workspace_id, id)
);
create index if not exists idx_report_schedules_due on public.report_schedules (workspace_id, next_run_at) where active;
create index if not exists idx_report_schedules_created_by on public.report_schedules (created_by);

-- 4) Histórico / fila de envio -----------------------------------------------------------
create table if not exists public.reports (
    id             uuid primary key default gen_random_uuid(),
    workspace_id   uuid not null references public.workspaces(id) on delete cascade,
    ad_account_id  uuid,
    client_id      uuid,
    title          text not null,
    period_key     text,
    period_since   date not null,
    period_until   date not null,
    payload        jsonb not null,                             -- métricas reais do período (para o card/PNG)
    message        text not null default '' check (char_length(message) <= 4000),
    status         text not null default 'rascunho' check (status in ('rascunho', 'agendado', 'enviando', 'enviado', 'falhou', 'cancelado')),
    group_jid      text check (group_jid is null or group_jid ~ '^[0-9-]+@g\.us$'),
    group_name     text,
    scheduled_at   timestamptz,
    sent_at        timestamptz,
    error          text,
    schedule_id    uuid,
    created_by     uuid references auth.users(id) on delete set null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    unique (workspace_id, id),
    foreign key (workspace_id, ad_account_id) references public.ad_accounts (workspace_id, id) on delete set null (ad_account_id),
    foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete set null (client_id),
    foreign key (workspace_id, schedule_id) references public.report_schedules (workspace_id, id) on delete set null (schedule_id)
);
create index if not exists idx_reports_ws_created on public.reports (workspace_id, created_at desc);
create index if not exists idx_reports_queue on public.reports (workspace_id, status, scheduled_at);
create index if not exists idx_reports_account on public.reports (ad_account_id);
create index if not exists idx_reports_client on public.reports (client_id);
create index if not exists idx_reports_schedule on public.reports (schedule_id);
create index if not exists idx_reports_created_by on public.reports (created_by);

-- updated_at -----------------------------------------------------------------------------
do $$
declare t text;
begin
    foreach t in array array['report_targets', 'report_settings', 'report_schedules', 'reports'] loop
        execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s', t);
        execute format('create trigger trg_%1$s_updated_at before update on public.%1$s for each row execute function public.set_updated_at()', t);
    end loop;
end $$;

-- RLS ---------------------------------------------------------------------------------------
-- Grupos: membros leem; só o robô (service role) escreve.
alter table public.whatsapp_groups enable row level security;
revoke all on public.whatsapp_groups from anon;
revoke insert, update, delete on public.whatsapp_groups from authenticated;
drop policy if exists whatsapp_groups_select on public.whatsapp_groups;
create policy whatsapp_groups_select on public.whatsapp_groups for select to authenticated using (public.is_workspace_member(workspace_id));

-- Demais: membros leem; dono/coordenador/editor operam; apagar só dono/coordenador.
do $$
declare t text;
begin
    foreach t in array array['report_targets', 'report_settings', 'report_schedules', 'reports'] loop
        execute format('alter table public.%1$s enable row level security', t);
        execute format('revoke all on public.%1$s from anon', t);
        execute format('drop policy if exists %1$s_select on public.%1$s', t);
        execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_workspace_member(workspace_id))', t);
        execute format('drop policy if exists %1$s_insert on public.%1$s', t);
        execute format($p$create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))$p$, t);
        execute format('drop policy if exists %1$s_update on public.%1$s', t);
        execute format($p$create policy %1$s_update on public.%1$s for update to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[])) with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))$p$, t);
        execute format('drop policy if exists %1$s_delete on public.%1$s', t);
        execute format($p$create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))$p$, t);
    end loop;
end $$;
