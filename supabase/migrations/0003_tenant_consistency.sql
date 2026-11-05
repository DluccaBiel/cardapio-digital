-- ============================================================================
-- 0003_tenant_consistency.sql — Consistência de tenant (FK composta)
-- Pré-requisito: 0001_init.sql + 0002_rls.sql (não editados)
--
-- Motivação: FKs são verificadas SEM aplicar RLS. Um usuário do workspace A
-- podia criar uma linha com workspace_id = A apontando para uma linha do
-- workspace B (UUID conhecido), e a policy não impedia, pois só olha o
-- workspace_id da própria linha. Correção: FKs compostas (workspace_id, col)
-- referenciando UNIQUE (workspace_id, id) do pai, preservando ON DELETE.
-- owner_id polimórfico (menu_images/menu_image_history) não cabe em FK —
-- validado por trigger com a MESMA regra (workspace_id do filho == do pai).
-- ============================================================================

-- ============================================================================
-- 1) UNIQUE (workspace_id, id) nos pais com workspace_id
--    (id já é PK; o UNIQUE composto existe só para ancorar as FKs compostas)
-- ============================================================================

alter table public.clients            add constraint uq_clients_ws_id            unique (workspace_id, id);
alter table public.tags               add constraint uq_tags_ws_id               unique (workspace_id, id);
alter table public.menu_categories    add constraint uq_menu_categories_ws_id    unique (workspace_id, id);
alter table public.menu_items         add constraint uq_menu_items_ws_id         unique (workspace_id, id);
alter table public.menu_addon_groups  add constraint uq_menu_addon_groups_ws_id  unique (workspace_id, id);
alter table public.menu_images        add constraint uq_menu_images_ws_id        unique (workspace_id, id);
alter table public.api_keys           add constraint uq_api_keys_ws_id           unique (workspace_id, id);
alter table public.webhooks           add constraint uq_webhooks_ws_id           unique (workspace_id, id);

-- ============================================================================
-- 2) FKs compostas (derruba a FK simples, recria preservando ON DELETE)
-- ============================================================================

-- client_tags -> clients / tags (junction; CASCADE)
alter table public.client_tags drop constraint client_tags_client_id_fkey;
alter table public.client_tags
    add constraint client_tags_ws_client_fkey
    foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete cascade;

alter table public.client_tags drop constraint client_tags_tag_id_fkey;
alter table public.client_tags
    add constraint client_tags_ws_tag_fkey
    foreign key (workspace_id, tag_id) references public.tags (workspace_id, id) on delete cascade;

-- ad_accounts -> clients (client_id era NO ACTION -> CASCADE; agora: manter exatamente o comportamento atual!)
-- Comportamento real na base: ON DELETE SET NULL. Preservado com lista de colunas (PG 15+).
alter table public.ad_accounts drop constraint ad_accounts_client_id_fkey;
alter table public.ad_accounts
    add constraint ad_accounts_ws_client_fkey
    foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete set null (client_id);

-- menu_categories -> clients (CASCADE)
alter table public.menu_categories drop constraint menu_categories_client_id_fkey;
alter table public.menu_categories
    add constraint menu_categories_ws_client_fkey
    foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete cascade;

-- menu_items -> clients / menu_categories (CASCADE)
alter table public.menu_items drop constraint menu_items_client_id_fkey;
alter table public.menu_items
    add constraint menu_items_ws_client_fkey
    foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete cascade;

alter table public.menu_items drop constraint menu_items_category_id_fkey;
alter table public.menu_items
    add constraint menu_items_ws_category_fkey
    foreign key (workspace_id, category_id) references public.menu_categories (workspace_id, id) on delete cascade;

-- menu_addon_groups -> clients (CASCADE)
alter table public.menu_addon_groups drop constraint menu_addon_groups_client_id_fkey;
alter table public.menu_addon_groups
    add constraint menu_addon_groups_ws_client_fkey
    foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete cascade;

-- menu_subitems -> menu_addon_groups (CASCADE)
alter table public.menu_subitems drop constraint menu_subitems_group_id_fkey;
alter table public.menu_subitems
    add constraint menu_subitems_ws_group_fkey
    foreign key (workspace_id, group_id) references public.menu_addon_groups (workspace_id, id) on delete cascade;

-- menu_item_addon_groups -> menu_items / menu_addon_groups (CASCADE)
alter table public.menu_item_addon_groups drop constraint menu_item_addon_groups_item_id_fkey;
alter table public.menu_item_addon_groups
    add constraint menu_item_addon_groups_ws_item_fkey
    foreign key (workspace_id, item_id) references public.menu_items (workspace_id, id) on delete cascade;

alter table public.menu_item_addon_groups drop constraint menu_item_addon_groups_group_id_fkey;
alter table public.menu_item_addon_groups
    add constraint menu_item_addon_groups_ws_group_fkey
    foreign key (workspace_id, group_id) references public.menu_addon_groups (workspace_id, id) on delete cascade;

-- menu_image_history -> menu_images (SET NULL no par referenciado apenas)
alter table public.menu_image_history drop constraint menu_image_history_menu_image_id_fkey;
alter table public.menu_image_history
    add constraint menu_image_history_ws_image_fkey
    foreign key (workspace_id, menu_image_id) references public.menu_images (workspace_id, id) on delete set null (menu_image_id);

-- extension_installs -> api_keys (api_key_id era SET NULL; api_key_id pode ser NULL)
alter table public.extension_installs drop constraint extension_installs_api_key_id_fkey;
alter table public.extension_installs
    add constraint extension_installs_ws_key_fkey
    foreign key (workspace_id, api_key_id) references public.api_keys (workspace_id, id) on delete set null (api_key_id);

-- webhook_deliveries -> webhooks (CASCADE)
alter table public.webhook_deliveries drop constraint webhook_deliveries_webhook_id_fkey;
alter table public.webhook_deliveries
    add constraint webhook_deliveries_ws_webhook_fkey
    foreign key (workspace_id, webhook_id) references public.webhooks (workspace_id, id) on delete cascade;

-- ============================================================================
-- 3) Triggers de consistência para owner_id polimórfico
--    menu_images.owner_id / menu_image_history.owner_id apontam para
--    menu_items OU menu_subitems conforme owner_type — FK impossível;
--    validamos que o pai existe E pertence ao MESMO workspace_id.
-- ============================================================================

create or replace function public.validate_menu_image_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.owner_type = 'menu_item' then
        if not exists (select 1 from public.menu_items i
                       where i.id = new.owner_id and i.workspace_id = new.workspace_id) then
            raise exception 'menu_images: menu_item % não existe no workspace % (consistência de tenant)', new.owner_id, new.workspace_id
                using errcode = '23503';
        end if;
    elsif new.owner_type = 'menu_subitem' then
        if not exists (select 1 from public.menu_subitems s
                       where s.id = new.owner_id and s.workspace_id = new.workspace_id) then
            raise exception 'menu_images: menu_subitem % não existe no workspace % (consistência de tenant)', new.owner_id, new.workspace_id
                using errcode = '23503';
        end if;
    else
        raise exception 'menu_images: owner_type inválido: %', new.owner_type using errcode = '23502';
    end if;
    return new;
end $$;

drop trigger if exists trg_menu_images_owner on public.menu_images;
create trigger trg_menu_images_owner
    before insert or update of owner_type, owner_id, workspace_id
    on public.menu_images
    for each row execute function public.validate_menu_image_owner();

create or replace function public.validate_menu_image_history_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.owner_type = 'menu_item' then
        if not exists (select 1 from public.menu_items i
                       where i.id = new.owner_id and i.workspace_id = new.workspace_id) then
            raise exception 'menu_image_history: menu_item % não existe no workspace % (consistência de tenant)', new.owner_id, new.workspace_id
                using errcode = '23503';
        end if;
    elsif new.owner_type = 'menu_subitem' then
        if not exists (select 1 from public.menu_subitems s
                       where s.id = new.owner_id and s.workspace_id = new.workspace_id) then
            raise exception 'menu_image_history: menu_subitem % não existe no workspace % (consistência de tenant)', new.owner_id, new.workspace_id
                using errcode = '23503';
        end if;
    else
        raise exception 'menu_image_history: owner_type inválido: %', new.owner_type using errcode = '23502';
    end if;
    return new;
end $$;

drop trigger if exists trg_menu_image_history_owner on public.menu_image_history;
create trigger trg_menu_image_history_owner
    before insert or update of owner_type, owner_id, workspace_id
    on public.menu_image_history
    for each row execute function public.validate_menu_image_history_owner();

-- ============================================================================
-- 4) Índices para as novas FKs compostas (o Postgres não cria automaticamente)
-- ============================================================================

create index idx_client_tags_ws_client on public.client_tags (workspace_id, client_id);
create index idx_client_tags_ws_tag    on public.client_tags (workspace_id, tag_id);
create index idx_ad_accounts_ws_client on public.ad_accounts (workspace_id, client_id);
create index idx_menu_categories_ws_client on public.menu_categories (workspace_id, client_id);
create index idx_menu_items_ws_client on public.menu_items (workspace_id, client_id);
create index idx_menu_items_ws_category on public.menu_items (workspace_id, category_id);
create index idx_menu_addon_groups_ws_client on public.menu_addon_groups (workspace_id, client_id);
create index idx_menu_subitems_ws_group on public.menu_subitems (workspace_id, group_id);
create index idx_menu_item_addon_groups_ws_item on public.menu_item_addon_groups (workspace_id, item_id);
create index idx_menu_item_addon_groups_ws_group on public.menu_item_addon_groups (workspace_id, group_id);
create index idx_menu_image_history_ws_image on public.menu_image_history (workspace_id, menu_image_id);
create index idx_extension_installs_ws_key on public.extension_installs (workspace_id, api_key_id);
create index idx_webhook_deliveries_ws_webhook on public.webhook_deliveries (workspace_id, webhook_id);
