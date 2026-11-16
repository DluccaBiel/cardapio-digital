-- ============================================================================
-- 20261116210000_meta_integrations.sql — Conexão com o Facebook (OAuth) e vários portfólios
-- Pré-requisitos: 0001..0010 + 20261116152908. BACKUP antes de aplicar em produção.
--
--   1) meta_connections        conta do Facebook conectada ao workspace (sem token)
--   2) meta_connection_tokens  token de longa duração CRIPTOGRAFADO (AES-256-GCM,
--                              chave META_TOKEN_KEY só no servidor). RLS ligado e
--                              SEM policies: só a service role lê/escreve.
--   3) meta_businesses         portfólios (Business Managers) visíveis pela conexão;
--                              `enabled` = portfólio conectado para sincronizar.
--   4) ad_accounts             + vínculo ao portfólio e métricas da sincronização
--                              (gasto ontem/7d, faturamento do mês, ROAS, término,
--                              última alteração).
--
-- Aditiva: só cria tabelas/colunas. RLS em todas as tabelas novas.
-- ============================================================================

-- 1) Conexões ----------------------------------------------------------------
create table if not exists public.meta_connections (
    id                uuid primary key default gen_random_uuid(),
    workspace_id      uuid not null references public.workspaces(id) on delete cascade,
    fb_user_id        text not null,
    fb_user_name      text,                                    -- [PII/LGPD] nome do perfil
    connected_by      uuid references auth.users(id) on delete set null,
    scopes            text[] not null default '{}',
    token_expires_at  timestamptz,
    status            text not null default 'active' check (status in ('active', 'expired', 'revoked')),
    last_error        text,                                    -- sem dados sensíveis
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (workspace_id, fb_user_id),
    unique (workspace_id, id)
);
comment on table public.meta_connections is 'Conta do Facebook conectada ao workspace via OAuth. O token fica em meta_connection_tokens (criptografado).';
create index if not exists idx_meta_connections_ws on public.meta_connections (workspace_id);

-- 2) Tokens (só service role) -----------------------------------------------
create table if not exists public.meta_connection_tokens (
    connection_id     uuid primary key references public.meta_connections(id) on delete cascade,
    workspace_id      uuid not null references public.workspaces(id) on delete cascade,
    token_ciphertext  text not null,                           -- AES-256-GCM (iv.tag.dados, base64)
    updated_at        timestamptz not null default now()
);
comment on table public.meta_connection_tokens is 'Token de acesso da Meta, criptografado. RLS sem policies: inacessível para usuários; só a service role.';
create index if not exists idx_meta_connection_tokens_ws on public.meta_connection_tokens (workspace_id);

-- 3) Portfólios ----------------------------------------------------------------
create table if not exists public.meta_businesses (
    id                uuid primary key default gen_random_uuid(),
    workspace_id      uuid not null references public.workspaces(id) on delete cascade,
    connection_id     uuid not null,
    business_id       text not null check (business_id ~ '^\d{5,25}$'),
    name              text not null,
    enabled           boolean not null default false,
    last_synced_at    timestamptz,
    accounts_count    integer not null default 0,
    sync_error        text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (workspace_id, business_id),
    unique (workspace_id, id),
    foreign key (workspace_id, connection_id) references public.meta_connections (workspace_id, id) on delete cascade
);
comment on table public.meta_businesses is 'Portfólios empresariais da Meta visíveis pela conexão; enabled = sincronizar contas deste portfólio.';
create index if not exists idx_meta_businesses_ws on public.meta_businesses (workspace_id) where enabled;
create index if not exists idx_meta_businesses_connection on public.meta_businesses (connection_id);

-- 4) ad_accounts: vínculo + métricas ---------------------------------------------
alter table public.ad_accounts add column if not exists meta_business_id     uuid;
alter table public.ad_accounts add column if not exists spend_yesterday      numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists spend_7d             numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists revenue_month        numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists roas_month           numeric(10,2);
alter table public.ad_accounts add column if not exists ends_at              timestamptz;
alter table public.ad_accounts add column if not exists runs_continuously    boolean not null default false;
alter table public.ad_accounts add column if not exists last_change_at       timestamptz;
alter table public.ad_accounts add column if not exists active_adsets        integer not null default 0;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'fk_ad_accounts_meta_business') then
        alter table public.ad_accounts
            add constraint fk_ad_accounts_meta_business
            foreign key (workspace_id, meta_business_id) references public.meta_businesses (workspace_id, id)
            on delete set null (meta_business_id);
    end if;
end $$;
create index if not exists idx_ad_accounts_meta_business on public.ad_accounts (meta_business_id);

comment on column public.ad_accounts.spend_7d is 'Gasto dos últimos 7 dias completos (base para "dias de saldo").';
comment on column public.ad_accounts.revenue_month is 'Valor de compras atribuído no mês (action_values purchase).';
comment on column public.ad_accounts.roas_month is 'ROAS do mês = revenue_month / spend_month (null sem gasto).';
comment on column public.ad_accounts.ends_at is 'Maior end_time entre os conjuntos de anúncios ativos (null se nenhum tem término).';
comment on column public.ad_accounts.runs_continuously is 'true se algum conjunto ativo não tem data de término.';
comment on column public.ad_accounts.last_change_at is 'Última alteração (updated_time) entre conjuntos de anúncios.';

-- updated_at ----------------------------------------------------------------------
drop trigger if exists trg_meta_connections_updated_at on public.meta_connections;
create trigger trg_meta_connections_updated_at before update on public.meta_connections for each row execute function public.set_updated_at();
drop trigger if exists trg_meta_businesses_updated_at on public.meta_businesses;
create trigger trg_meta_businesses_updated_at before update on public.meta_businesses for each row execute function public.set_updated_at();
drop trigger if exists trg_meta_connection_tokens_updated_at on public.meta_connection_tokens;
create trigger trg_meta_connection_tokens_updated_at before update on public.meta_connection_tokens for each row execute function public.set_updated_at();

-- RLS --------------------------------------------------------------------------
alter table public.meta_connections        enable row level security;
alter table public.meta_connection_tokens  enable row level security;   -- sem policies (só service role)
alter table public.meta_businesses         enable row level security;

drop policy if exists meta_connections_select on public.meta_connections;
create policy meta_connections_select on public.meta_connections
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists meta_connections_insert on public.meta_connections;
create policy meta_connections_insert on public.meta_connections
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists meta_connections_update on public.meta_connections;
create policy meta_connections_update on public.meta_connections
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists meta_connections_delete on public.meta_connections;
create policy meta_connections_delete on public.meta_connections
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

drop policy if exists meta_businesses_select on public.meta_businesses;
create policy meta_businesses_select on public.meta_businesses
    for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists meta_businesses_insert on public.meta_businesses;
create policy meta_businesses_insert on public.meta_businesses
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists meta_businesses_update on public.meta_businesses;
create policy meta_businesses_update on public.meta_businesses
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists meta_businesses_delete on public.meta_businesses;
create policy meta_businesses_delete on public.meta_businesses
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

revoke all on public.meta_connection_tokens from anon, authenticated;

-- Política explícita de negação: usuários nunca leem/escrevem tokens (service role ignora RLS).
drop policy if exists meta_connection_tokens_deny on public.meta_connection_tokens;
create policy meta_connection_tokens_deny on public.meta_connection_tokens
    for all to authenticated using (false) with check (false);

create index if not exists idx_meta_connections_connected_by on public.meta_connections (connected_by);
