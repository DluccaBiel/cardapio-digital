-- ============================================================================
-- 20261125120100_member_invites.sql — link de convite + isolamento do colaborador
-- Pré-requisito: 20261125120000_colaborador_role.sql
--
-- 1) O colaborador é membro do workspace, mas NÃO conta como "membro" para as
--    policies de dados (clientes, cardápio, contas, relatórios, SDR…): todas
--    usam is_workspace_member(), que passa a excluí-lo. Resultado: mesmo
--    chamando o PostgREST direto com a sessão dele, não lê nenhum dado de negócio.
-- 2) Ele continua enxergando o próprio vínculo (members) e o workspace
--    (nome/slug), que o app precisa para montar o menu.
-- 3) member_invites guarda só o HASH do token do link (valor em claro aparece
--    uma vez para o owner, como nas chaves de API).
-- ============================================================================

-- Qualquer vínculo (inclui colaborador)
create or replace function public.is_workspace_any_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.members
        where workspace_id = ws and user_id = auth.uid()
    );
$$;
revoke all on function public.is_workspace_any_member(uuid) from public;
grant execute on function public.is_workspace_any_member(uuid) to authenticated;

-- Membro "de equipe": tudo menos colaborador (comparação em texto para não
-- depender do valor novo do enum dentro da mesma transação).
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.members
        where workspace_id = ws and user_id = auth.uid() and role::text <> 'colaborador'
    );
$$;

drop policy if exists workspaces_select on public.workspaces;
create policy workspaces_select on public.workspaces
    for select to authenticated
    using (public.is_workspace_any_member(id));

drop policy if exists members_select on public.members;
create policy members_select on public.members
    for select to authenticated
    using (public.is_workspace_member(workspace_id) or user_id = auth.uid());

-- Convites -------------------------------------------------------------------
create table if not exists public.member_invites (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    token_hash    text not null unique,                 -- sha256 hex do token; o token em claro nunca é gravado
    role          public.member_role not null default 'colaborador',
    label         text,                                 -- nome de quem vai receber (ex.: "Ana — design")
    created_by    uuid references auth.users(id) on delete set null,
    expires_at    timestamptz not null,
    revoked_at    timestamptz,
    used_at       timestamptz,
    used_by       uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    constraint member_invites_role_chk check (role::text in ('colaborador'))
);
comment on table public.member_invites is 'Links de convite de colaborador (uso único, expiram). Só o hash do token fica no banco.';
create index if not exists idx_member_invites_ws on public.member_invites (workspace_id, created_at desc);

alter table public.member_invites enable row level security;

-- Leitura: owner/suporte. Escrita: somente service_role (server actions).
create policy member_invites_select on public.member_invites
    for select to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
