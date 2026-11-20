-- ============================================================================
-- 20261120130000_google_calendar.sql — Google Agenda para a IA do SDR marcar reuniões
-- Pré-requisitos: 20261120120000_sdr_whatsapp.sql. BACKUP antes de aplicar em produção.
--
--   google_connections  conta Google conectada ao workspace (sem token)
--   google_tokens       refresh token CRIPTOGRAFADO (AES-256-GCM, chave do servidor).
--                       RLS ligado e negação explícita: só a service role lê/escreve.
-- ============================================================================

create table if not exists public.google_connections (
    workspace_id   uuid primary key references public.workspaces(id) on delete cascade,
    email          text,                                         -- [PII/LGPD] conta conectada
    calendar_id    text not null default 'primary',
    status         text not null default 'active' check (status in ('active', 'revoked', 'error')),
    last_error     text,
    connected_by   uuid references auth.users(id) on delete set null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
comment on table public.google_connections is 'Google Agenda conectado ao workspace (a IA do SDR consulta horários livres e cria a reunião).';
create index if not exists idx_google_connections_connected_by on public.google_connections (connected_by);

create table if not exists public.google_tokens (
    workspace_id        uuid primary key references public.workspaces(id) on delete cascade,
    refresh_ciphertext  text not null,
    updated_at          timestamptz not null default now()
);
comment on table public.google_tokens is 'Refresh token do Google, criptografado. Inacessível para usuários; só a service role.';

drop trigger if exists trg_google_connections_updated_at on public.google_connections;
create trigger trg_google_connections_updated_at before update on public.google_connections for each row execute function public.set_updated_at();
drop trigger if exists trg_google_tokens_updated_at on public.google_tokens;
create trigger trg_google_tokens_updated_at before update on public.google_tokens for each row execute function public.set_updated_at();

alter table public.google_connections enable row level security;
alter table public.google_tokens enable row level security;
revoke all on public.google_connections from anon;
revoke all on public.google_tokens from anon, authenticated;

drop policy if exists google_connections_select on public.google_connections;
create policy google_connections_select on public.google_connections
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists google_connections_delete on public.google_connections;
create policy google_connections_delete on public.google_connections
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
drop policy if exists google_tokens_deny on public.google_tokens;
create policy google_tokens_deny on public.google_tokens for all to authenticated using (false) with check (false);
