-- ============================================================================
-- 0002_rls.sql — Row Level Security por workspace e por papel
-- Pré-requisito: 0001_init.sql
--
-- Papéis: owner > coordenador > editor > visualizador
--   owner        : acesso total ao workspace (inclui membros e configurações)
--   coordenador  : gestão operacional (clientes, cardápio, anúncios, webhooks, chaves)
--   editor       : operação de conteúdo (cardápio e clientes) — sem membros, chaves ou webhooks
--   visualizador : somente leitura de dados de negócio — sem chaves, webhooks, extensões ou auditoria
--
-- service_role (servidor) IGNORA RLS por definição do Supabase. Chaves de API de
-- extensões NÃO usam RLS pelo PostgREST: passam pela API route, que valida a key
-- e aplica filtro de workspace_id explicitamente (ver docs/api.md e docs/extensoes.md).
-- ============================================================================

-- ============================================================================
-- FUNÇÕES AUXILIARES (security definer p/ evitar recursão em members)
-- ============================================================================

create or replace function public.is_workspace_member(ws uuid)
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

create or replace function public.current_workspace_role(ws uuid)
returns member_role
language sql
stable
security definer
set search_path = public
as $$
    select role from public.members
    where workspace_id = ws and user_id = auth.uid();
$$;

create or replace function public.has_workspace_role(ws uuid, roles member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(public.current_workspace_role(ws) = any(roles), false);
$$;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.current_workspace_role(uuid) from public;
revoke all on function public.has_workspace_role(uuid, member_role[]) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.current_workspace_role(uuid) to authenticated;
grant execute on function public.has_workspace_role(uuid, member_role[]) to authenticated;

-- ============================================================================
-- ATIVAR RLS EM TODAS AS TABELAS
-- ============================================================================

alter table public.workspaces              enable row level security;
alter table public.members                 enable row level security;
alter table public.clients                 enable row level security;
alter table public.tags                    enable row level security;
alter table public.client_tags             enable row level security;
alter table public.ad_accounts             enable row level security;
alter table public.menu_categories         enable row level security;
alter table public.menu_items              enable row level security;
alter table public.menu_addon_groups       enable row level security;
alter table public.menu_subitems           enable row level security;
alter table public.menu_item_addon_groups  enable row level security;
alter table public.menu_images             enable row level security;
alter table public.menu_image_history      enable row level security;
alter table public.extensions              enable row level security;
alter table public.api_keys                enable row level security;
alter table public.extension_installs      enable row level security;
alter table public.webhooks                enable row level security;
alter table public.webhook_deliveries      enable row level security;
alter table public.audit_log               enable row level security;

-- ============================================================================
-- WORKSPACES
-- ============================================================================

create policy workspaces_select on public.workspaces
    for select to authenticated
    using (public.is_workspace_member(id));

create policy workspaces_insert on public.workspaces
    for insert to authenticated
    with check (true); -- qualquer usuário autenticado pode criar um workspace (vira owner via app)

create policy workspaces_update on public.workspaces
    for update to authenticated
    using (public.has_workspace_role(id, array['owner']::member_role[]))
    with check (public.has_workspace_role(id, array['owner']::member_role[]));

create policy workspaces_delete on public.workspaces
    for delete to authenticated
    using (public.has_workspace_role(id, array['owner']::member_role[]));

-- ============================================================================
-- MEMBERS
-- ============================================================================

create policy members_select on public.members
    for select to authenticated
    using (public.is_workspace_member(workspace_id));

create policy members_insert on public.members
    for insert to authenticated
    with check (
        public.has_workspace_role(workspace_id, array['owner']::member_role[])
        -- coordenador pode convidar, mas nunca como owner:
        or (public.has_workspace_role(workspace_id, array['coordenador']::member_role[]) and role <> 'owner')
    );

create policy members_update on public.members
    for update to authenticated
    using (
        public.has_workspace_role(workspace_id, array['owner']::member_role[])
        or (public.has_workspace_role(workspace_id, array['coordenador']::member_role[]) and role <> 'owner')
    )
    with check (
        public.has_workspace_role(workspace_id, array['owner']::member_role[])
        or (public.has_workspace_role(workspace_id, array['coordenador']::member_role[]) and role <> 'owner')
    );

create policy members_delete on public.members
    for delete to authenticated
    using (
        public.has_workspace_role(workspace_id, array['owner']::member_role[])
        or (public.has_workspace_role(workspace_id, array['coordenador']::member_role[]) and role <> 'owner')
    );

-- ============================================================================
-- CLIENTS  (leitura: todos; escrita: owner/coordenador/editor; remoção: owner/coordenador)
-- ============================================================================

create policy clients_select on public.clients
    for select to authenticated
    using (public.is_workspace_member(workspace_id));

create policy clients_insert on public.clients
    for insert to authenticated
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

create policy clients_update on public.clients
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

create policy clients_delete on public.clients
    for delete to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

-- ============================================================================
-- TAGS / CLIENT_TAGS  (mesma regra de clients)
-- ============================================================================

create policy tags_select on public.tags
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy tags_insert on public.tags
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy tags_update on public.tags
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy tags_delete on public.tags
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

create policy client_tags_select on public.client_tags
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy client_tags_insert on public.client_tags
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy client_tags_delete on public.client_tags
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- ============================================================================
-- AD_ACCOUNTS  (leitura: todos; escrita/remoção: owner/coordenador)
-- ============================================================================

create policy ad_accounts_select on public.ad_accounts
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy ad_accounts_insert on public.ad_accounts
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy ad_accounts_update on public.ad_accounts
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy ad_accounts_delete on public.ad_accounts
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

-- ============================================================================
-- CARDÁPIO  (leitura: todos; escrita: owner/coordenador/editor; remoção: owner/coordenador/editor)
-- ============================================================================
-- menu_categories
create policy menu_categories_select on public.menu_categories
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_categories_insert on public.menu_categories
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_categories_update on public.menu_categories
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_categories_delete on public.menu_categories
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- menu_items
create policy menu_items_select on public.menu_items
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_items_insert on public.menu_items
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_items_update on public.menu_items
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_items_delete on public.menu_items
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- menu_addon_groups
create policy menu_addon_groups_select on public.menu_addon_groups
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_addon_groups_insert on public.menu_addon_groups
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_addon_groups_update on public.menu_addon_groups
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_addon_groups_delete on public.menu_addon_groups
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- menu_subitems (workspace_id denormalizado na própria linha, como nas demais tabelas)
create policy menu_subitems_select on public.menu_subitems
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_subitems_insert on public.menu_subitems
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_subitems_update on public.menu_subitems
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_subitems_delete on public.menu_subitems
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- menu_item_addon_groups
create policy menu_item_addon_groups_select on public.menu_item_addon_groups
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_item_addon_groups_insert on public.menu_item_addon_groups
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_item_addon_groups_update on public.menu_item_addon_groups
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_item_addon_groups_delete on public.menu_item_addon_groups
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- ============================================================================
-- IMAGENS  (leitura: todos; escrita: owner/coordenador/editor; histórico imutável)
-- ============================================================================

create policy menu_images_select on public.menu_images
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_images_insert on public.menu_images
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
create policy menu_images_update on public.menu_images
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
-- Sem DELETE: imagens são aposentadas via is_current=false; exclusão definitiva só via service_role (job de retenção).

create policy menu_image_history_select on public.menu_image_history
    for select to authenticated using (public.is_workspace_member(workspace_id));
create policy menu_image_history_insert on public.menu_image_history
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
-- Sem UPDATE/DELETE: histórico é imutável. Expurgo apenas por job com service_role, respeitando a retenção.

-- ============================================================================
-- EXTENSIONS (catálogo global: leitura autenticada; escrita só service_role)
-- ============================================================================

create policy extensions_select on public.extensions
    for select to authenticated using (true);

-- ============================================================================
-- API_KEYS  (owner/coordenador apenas — editor e visualizador NÃO veem nem gerenciam)
-- ============================================================================

create policy api_keys_select on public.api_keys
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy api_keys_insert on public.api_keys
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy api_keys_update on public.api_keys
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy api_keys_delete on public.api_keys
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner']::member_role[]));

-- ============================================================================
-- EXTENSION_INSTALLS  (owner/coordenador gerenciam; editor/visualizador sem acesso)
-- ============================================================================

create policy extension_installs_select on public.extension_installs
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy extension_installs_insert on public.extension_installs
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy extension_installs_update on public.extension_installs
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy extension_installs_delete on public.extension_installs
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner']::member_role[]));

-- ============================================================================
-- WEBHOOKS / WEBHOOK_DELIVERIES  (owner/coordenador apenas)
-- ============================================================================

create policy webhooks_select on public.webhooks
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy webhooks_insert on public.webhooks
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy webhooks_update on public.webhooks
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
create policy webhooks_delete on public.webhooks
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));

create policy webhook_deliveries_select on public.webhook_deliveries
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
-- INSERT/UPDATE somente via service_role (worker de entrega)

-- ============================================================================
-- AUDIT_LOG  (leitura: owner/coordenador; escrita: apenas service_role)
-- ============================================================================

create policy audit_log_select on public.audit_log
    for select to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador']::member_role[]));
-- Sem INSERT/UPDATE/DELETE para authenticated: trilha imutável, gravada pelo servidor.

-- ============================================================================
-- STORAGE (bucket menu-images — privado)
-- ============================================================================
-- Caminho esperado: {workspace_id}/{client_id}/{owner_type}/{owner_id}/{version}.{ext}
-- Leitura: membros do workspace via signed URL gerada pelo servidor.
-- Escrita: apenas service_role (a API valida e faz upload). Extensões nunca falam
-- direto com o bucket — passam pela API com upload multipart/base64.

-- workspace_id da pasta-raiz do objeto, com tolerância a caminhos malformados
-- (cast direto para uuid lançaria erro em vez de negar acesso)
create or replace function public.storage_workspace_id(object_name text)
returns uuid
language plpgsql
stable
as $$
begin
    return ((storage.foldername(object_name))[1])::uuid;
exception when others then
    return null;
end;
$$;

revoke all on function public.storage_workspace_id(text) from public;
grant execute on function public.storage_workspace_id(text) to authenticated;

create policy storage_menu_images_select on storage.objects
    for select to authenticated
    using (
        bucket_id = 'menu-images'
        and public.storage_workspace_id(name) is not null
        and public.is_workspace_member(public.storage_workspace_id(name))
    );
-- Sem policy de INSERT/UPDATE/DELETE para authenticated: escrita só via service_role.
