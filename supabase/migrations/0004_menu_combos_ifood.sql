-- ============================================================================
-- 0004_menu_combos_ifood.sql — Combos + vínculo com o iFood + fila de sincronização
-- Pré-requisito: 0001_init.sql, 0002_rls.sql, 0003_tenant_consistency.sql (não editados)
--
-- LEMBRETE OPERACIONAL: BACKUP antes de aplicar em produção
--   (npx supabase db dump --linked > backups/pre-0004_<data>.sql) e teste antes
--   com `npx supabase db reset` local.
--
-- O que muda:
--   1) menu_items.kind ('item' | 'combo') — combo é um produto do cardápio
--      (tem preço, categoria, status), composto por outros produtos.
--   2) menu_combo_components — composição N:N combo -> produtos (+ quantidade),
--      com FK composta (tenant) e trigger garantindo mesmo cliente e tipos certos.
--   3) ifood_* — IDs externos do iFood (preenchidos pela extensão na importação)
--      e ifood_synced_at, que define a fila "pendente para o iFood":
--          pendente  <=>  ifood_synced_at is null  or  updated_at > ifood_synced_at
--      (set_updated_at usa now(), igual dentro da transação: marcar como
--       sincronizado grava ifood_synced_at = now() e updated_at = now() juntos.)
--   4) clients.ifood_merchant_id — trava de segurança: a extensão não importa
--      o cardápio de uma loja do iFood para o cliente errado.
--   5) Catálogo global: registra a extensão 'orvia-ifood'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tipo do produto
-- ---------------------------------------------------------------------------
alter table public.menu_items
    add column if not exists kind text not null default 'item';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'menu_items_kind_check') then
        alter table public.menu_items
            add constraint menu_items_kind_check check (kind in ('item', 'combo'));
    end if;
end $$;

comment on column public.menu_items.kind is 'item = produto simples; combo = produto composto (ver menu_combo_components).';
create index if not exists idx_menu_items_kind on public.menu_items (client_id, kind);

-- ---------------------------------------------------------------------------
-- 2) IDs do iFood + controle de sincronização
-- ---------------------------------------------------------------------------
alter table public.clients           add column if not exists ifood_merchant_id text;
alter table public.menu_categories   add column if not exists ifood_id text;
alter table public.menu_items        add column if not exists ifood_id text;
alter table public.menu_items        add column if not exists ifood_synced_at timestamptz;
alter table public.menu_addon_groups add column if not exists ifood_id text;
alter table public.menu_subitems     add column if not exists ifood_id text;

comment on column public.clients.ifood_merchant_id is 'ID da loja no iFood (informado pela extensão). Impede importar cardápio de outra loja.';
comment on column public.menu_items.ifood_id is 'ID do produto no iFood. NULL = ainda não existe no iFood (ex.: combo criado no Orvia).';
comment on column public.menu_items.ifood_synced_at is 'Momento em que o iFood refletiu este produto. Pendente se NULL ou updated_at > ifood_synced_at.';

create unique index if not exists uq_clients_ifood_merchant
    on public.clients (workspace_id, ifood_merchant_id) where ifood_merchant_id is not null;
create unique index if not exists uq_menu_categories_ifood
    on public.menu_categories (client_id, ifood_id) where ifood_id is not null;
create unique index if not exists uq_menu_items_ifood
    on public.menu_items (client_id, ifood_id) where ifood_id is not null;
create unique index if not exists uq_menu_addon_groups_ifood
    on public.menu_addon_groups (client_id, ifood_id) where ifood_id is not null;
create unique index if not exists uq_menu_subitems_ifood
    on public.menu_subitems (group_id, ifood_id) where ifood_id is not null;

-- Fila de pendências por cliente (consulta frequente do painel e da extensão)
create index if not exists idx_menu_items_ifood_pending
    on public.menu_items (client_id, updated_at)
    where ifood_synced_at is null or updated_at > ifood_synced_at;

-- Marcar como sincronizado PRECISA usar o now() do banco (mesmo valor que o
-- trigger set_updated_at grava em updated_at) — por isso é RPC, não PATCH.
-- SECURITY INVOKER: RLS da sessão vale no painel; a API usa service role e
-- passa p_workspace explicitamente.
create or replace function public.mark_menu_items_ifood_synced(
    p_workspace uuid,
    p_items     uuid[],
    p_expected  timestamptz default null,   -- If-Match (só quando 1 item)
    p_ifood_id  text default null           -- ID criado no iFood (só quando 1 item)
)
returns table (id uuid, updated_at timestamptz, ifood_synced_at timestamptz, ifood_id text)
language sql
security invoker
set search_path = public
as $$
    update public.menu_items m
       set ifood_synced_at = now(),
           ifood_id = case when p_ifood_id is not null and cardinality(p_items) = 1 then p_ifood_id else m.ifood_id end
     where m.workspace_id = p_workspace
       and m.id = any (p_items)
       and (p_expected is null or m.updated_at = p_expected)
    returning m.id, m.updated_at, m.ifood_synced_at, m.ifood_id;
$$;
revoke all on function public.mark_menu_items_ifood_synced(uuid, uuid[], timestamptz, text) from public, anon;
grant execute on function public.mark_menu_items_ifood_synced(uuid, uuid[], timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Composição de combos
-- ---------------------------------------------------------------------------
create table if not exists public.menu_combo_components (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    combo_id      uuid not null,
    component_id  uuid not null,
    quantity      integer not null default 1 check (quantity between 1 and 20),
    sort_order    integer not null default 0,
    created_at    timestamptz not null default now(),
    unique (combo_id, component_id),
    check (combo_id <> component_id),
    constraint menu_combo_components_ws_combo_fkey
        foreign key (workspace_id, combo_id) references public.menu_items (workspace_id, id) on delete cascade,
    constraint menu_combo_components_ws_component_fkey
        foreign key (workspace_id, component_id) references public.menu_items (workspace_id, id) on delete cascade
);
comment on table public.menu_combo_components is 'Itens que compõem um combo (menu_items.kind = combo). Mesmo workspace (FK composta) e mesmo cliente (trigger).';
create index if not exists idx_mcc_ws_combo on public.menu_combo_components (workspace_id, combo_id, sort_order);
create index if not exists idx_mcc_ws_component on public.menu_combo_components (workspace_id, component_id);

create or replace function public.validate_menu_combo_component()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    combo_kind text;
    combo_client uuid;
    comp_kind text;
    comp_client uuid;
begin
    select kind, client_id into combo_kind, combo_client
      from public.menu_items where id = new.combo_id and workspace_id = new.workspace_id;
    select kind, client_id into comp_kind, comp_client
      from public.menu_items where id = new.component_id and workspace_id = new.workspace_id;

    if combo_kind is distinct from 'combo' then
        raise exception 'menu_combo_components: % não é um combo', new.combo_id using errcode = '23514';
    end if;
    if comp_kind is distinct from 'item' then
        raise exception 'menu_combo_components: componente % precisa ser um produto simples', new.component_id using errcode = '23514';
    end if;
    if combo_client is distinct from comp_client then
        raise exception 'menu_combo_components: combo e componente de clientes diferentes' using errcode = '23514';
    end if;
    return new;
end $$;

drop trigger if exists trg_menu_combo_components_validate on public.menu_combo_components;
create trigger trg_menu_combo_components_validate
    before insert or update on public.menu_combo_components
    for each row execute function public.validate_menu_combo_component();

-- Um produto que já compõe combos não pode virar combo (e vice-versa) sem limpar a composição.
create or replace function public.guard_menu_item_kind_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.kind is distinct from old.kind then
        if exists (select 1 from public.menu_combo_components c where c.combo_id = old.id or c.component_id = old.id) then
            raise exception 'menu_items: não é possível mudar o tipo de % enquanto ele participa de combos', old.id using errcode = '23514';
        end if;
    end if;
    return new;
end $$;

drop trigger if exists trg_menu_items_kind_guard on public.menu_items;
create trigger trg_menu_items_kind_guard
    before update of kind on public.menu_items
    for each row execute function public.guard_menu_item_kind_change();

-- Alterar a composição de um combo deixa o combo pendente para o iFood.
create or replace function public.touch_combo_on_components_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    update public.menu_items
       set updated_at = now()
     where id = coalesce(new.combo_id, old.combo_id)
       and workspace_id = coalesce(new.workspace_id, old.workspace_id);
    return null;
end $$;

drop trigger if exists trg_menu_combo_components_touch on public.menu_combo_components;
create trigger trg_menu_combo_components_touch
    after insert or update or delete on public.menu_combo_components
    for each row execute function public.touch_combo_on_components_change();

-- ---------------------------------------------------------------------------
-- 4) RLS — mesma matriz de menu_items (0002): leitura membros; escrita owner/coordenador/editor
-- ---------------------------------------------------------------------------
alter table public.menu_combo_components enable row level security;

drop policy if exists menu_combo_components_select on public.menu_combo_components;
create policy menu_combo_components_select on public.menu_combo_components
    for select to authenticated using (public.is_workspace_member(workspace_id));
drop policy if exists menu_combo_components_insert on public.menu_combo_components;
create policy menu_combo_components_insert on public.menu_combo_components
    for insert to authenticated with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
drop policy if exists menu_combo_components_update on public.menu_combo_components;
create policy menu_combo_components_update on public.menu_combo_components
    for update to authenticated
    using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]))
    with check (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));
drop policy if exists menu_combo_components_delete on public.menu_combo_components;
create policy menu_combo_components_delete on public.menu_combo_components
    for delete to authenticated using (public.has_workspace_role(workspace_id, array['owner','coordenador','editor']::member_role[]));

-- ---------------------------------------------------------------------------
-- 5) Catálogo global de extensões
-- ---------------------------------------------------------------------------
insert into public.extensions (slug, name, description, homepage_url)
values (
    'orvia-ifood',
    'Orvia · Otimizador iFood',
    'Lê o cardápio no Portal do Parceiro iFood, envia para o Orvia e guia a aplicação de combos e edições feitas no painel.',
    null
)
on conflict (slug) do nothing;
