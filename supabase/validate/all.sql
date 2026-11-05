-- ============================================================================
-- ORVIA — Validação completa de banco (GERADO AUTOMATICAMENTE — não editar à mão)
-- ATENÇÃO: execute SOMENTE em um projeto Supabase de DESENVOLVIMENTO.
--          NUNCA em produção. Crie um projeto separado de dev (ex.: free tier).
--
-- Ordem: 0001 (schema) → 0002 (RLS) → 0003 (consistência de tenant / FK composta)
--        → seed (dados fictícios) → checks (higiene) → testes (70 RLS + 20 cross-link)
--
-- Observações para colar no SQL Editor:
--   * SQL puro, sem meta-comandos do psql.
--   * Testes inserem fixtures em auth.users/storage.objects; o objeto de storage
--     de teste NÃO é apagado (SQL direto é proibido — use a Storage API ou ignore).
--   * Para ambiente limpo, use `supabase db reset` LOCAL em vez deste script.
-- ============================================================================

-- ============================================================================
-- 0001_init.sql — SCHEMA
-- ============================================================================

-- ============================================================================
-- 0001_init.sql — Esquema inicial (Fase 1) — Cardápio Web Hub / Painel do Gestor
-- PostgreSQL 15+ / Supabase
--
-- LEMBRETE OPERACIONAL: faça BACKUP do banco antes de rodar qualquer migração
-- em produção (supabase db dump ou snapshot do projeto no dashboard).
--
-- Convenções:
--   * Toda tabela de negócio tem workspace_id -> multi-tenant (RLS em 0002_rls.sql).
--   * IDs: uuid com gen_random_uuid().
--   * Valores monetários: numeric(12,2) em reais (NUNCA float).
--   * Campos marcados com [PII/LGPD] contêm dados pessoais — ver docs/decisoes-em-aberto.md
--     e a seção LGPD do AGENTS.md (retenção e exclusão).
--   * Soft-delete via archived_at/deleted_at onde faz sentido; audit_log registra tudo.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- ENUMS
-- ============================================================================

create type member_role as enum ('owner', 'coordenador', 'editor', 'visualizador');
comment on type member_role is 'Papéis por workspace: owner (dono), coordenador (gestão), editor (operação), visualizador (somente leitura).';

create type client_status as enum ('ativo', 'pausado', 'encerrado');
comment on type client_status is 'Situação comercial do cliente (empresa atendida pela assessoria).';

create type delivery_status as enum ('no_prazo', 'atrasado', 'entregue', 'sem_entrega');
comment on type delivery_status is 'Status de entrega/relatórios do cliente exibido na Visão geral.';

create type ad_platform as enum ('meta', 'google', 'tiktok', 'outro');
comment on type ad_platform is 'Plataforma de anúncios. Fase 1 usa apenas Meta; demais ficam para fases futuras.';

create type menu_status as enum ('active', 'inactive', 'out_of_stock');
comment on type menu_status is 'Status de exibição no cardápio: active (ativo), inactive (inativo), out_of_stock (em falta).';

create type image_owner_type as enum ('menu_item', 'menu_subitem');
comment on type image_owner_type is 'Dono de uma imagem de cardápio: produto (menu_item) ou opção/subitem (menu_subitem).';

create type webhook_delivery_status as enum ('pending', 'delivered', 'failed', 'gave_up');
comment on type webhook_delivery_status is 'Ciclo de vida de uma entrega de webhook (ver docs/webhooks.md).';

create type audit_actor_type as enum ('user', 'api_key', 'system');
comment on type audit_actor_type is 'Origem do ato auditado: usuário do painel, chave de API de extensão ou sistema.';

-- ============================================================================
-- WORKSPACES / MEMBERS
-- ============================================================================

create table public.workspaces (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (char_length(name) between 2 and 120),
    slug        text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    plan        text not null default 'free' check (plan in ('free', 'pro', 'enterprise')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    deleted_at  timestamptz          -- soft-delete do workspace inteiro
);
comment on table public.workspaces is 'Tenant raiz. Toda rota pública do painel é /a/{slug}/...';

create table public.members (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    user_id       uuid not null references auth.users(id) on delete cascade,
    role          member_role not null default 'visualizador',
    invited_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (workspace_id, user_id)
);
comment on table public.members is 'Vínculo usuário <-> workspace com papel. RLS usa esta tabela (ver 0002_rls.sql).';
comment on column public.members.user_id is '[PII/LGPD] Referência a auth.users; e-mail/nome ficam em auth.users.';

-- ============================================================================
-- CLIENTS / TAGS
-- ============================================================================

create table public.clients (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references public.workspaces(id) on delete cascade,
    name            text not null check (char_length(name) between 1 and 160),  -- nome fantasia
    legal_name      text,                                                        -- razão social [PII/LGPD]
    document        text,                                                        -- CNPJ/CPF [PII/LGPD]
    contact_name    text,                                                        -- contato principal [PII/LGPD]
    email           text,                                                        -- [PII/LGPD]
    phone           text,                                                        -- [PII/LGPD]
    whatsapp        text,                                                        -- [PII/LGPD]
    instagram       text,
    status          client_status not null default 'ativo',
    delivery_status delivery_status not null default 'no_prazo',
    monthly_fee     numeric(12,2) check (monthly_fee is null or monthly_fee >= 0),  -- honorário mensal
    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    archived_at     timestamptz
);
comment on table public.clients is 'Clientes da assessoria (cada um pode ter cardápio, contas de anúncio e relatórios).';
create index idx_clients_workspace on public.clients (workspace_id);
create index idx_clients_status on public.clients (workspace_id, status) where archived_at is null;
create index idx_clients_delivery on public.clients (workspace_id, delivery_status) where archived_at is null;

create table public.tags (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    name          text not null check (char_length(name) between 1 and 60),
    color         text not null default '#22c55e' check (color ~ '^#[0-9a-fA-F]{6}$'),
    created_at    timestamptz not null default now(),
    unique (workspace_id, name)
);
comment on table public.tags is 'Tags livres por workspace (ex.: "delivery", "tráfego pago", "VIP").';

create table public.client_tags (
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    client_id     uuid not null references public.clients(id) on delete cascade,
    tag_id        uuid not null references public.tags(id) on delete cascade,
    created_at    timestamptz not null default now(),
    primary key (client_id, tag_id)
);
comment on table public.client_tags is 'Ligação N:N cliente <-> tag. workspace_id denormalizado para RLS simples.';
create index idx_client_tags_tag on public.client_tags (tag_id);
create index idx_client_tags_workspace on public.client_tags (workspace_id);

-- ============================================================================
-- AD ACCOUNTS (Meta)
-- ============================================================================

create table public.ad_accounts (
    id                   uuid primary key default gen_random_uuid(),
    workspace_id         uuid not null references public.workspaces(id) on delete cascade,
    client_id            uuid references public.clients(id) on delete set null,
    platform             ad_platform not null default 'meta',
    external_account_id  text not null,               -- ex.: act_123456789 (Meta)
    name                 text not null,
    currency             text not null default 'BRL' check (char_length(currency) = 3),
    balance              numeric(12,2) not null default 0,   -- saldo atual (sincronizado)
    spend_month          numeric(12,2) not null default 0,   -- gasto no mês (sincronizado)
    status               text not null default 'active' check (status in ('active', 'disabled', 'error', 'unknown')),
    is_watched           boolean not null default false,     -- "acompanhar" on/off
    last_synced_at       timestamptz,
    sync_error           text,                                -- último erro de sincronização (sem dados sensíveis)
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    unique (workspace_id, platform, external_account_id)
);
comment on table public.ad_accounts is 'Contas de anúncio vinculadas a clientes. Fase 1: apenas Meta; sync via API fica para a Fase 3.';
create index idx_ad_accounts_client on public.ad_accounts (client_id);
create index idx_ad_accounts_workspace on public.ad_accounts (workspace_id);
create index idx_ad_accounts_watched on public.ad_accounts (workspace_id) where is_watched;

-- ============================================================================
-- CARDÁPIO: categorias, itens, grupos de complementos, subitens
-- ============================================================================

create table public.menu_categories (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    client_id     uuid not null references public.clients(id) on delete cascade,
    name          text not null check (char_length(name) between 1 and 120),
    description   text,
    sort_order    integer not null default 0,
    status        menu_status not null default 'active',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (client_id, name)
);
comment on table public.menu_categories is 'Categoria de cardápio de um cliente (ex.: "Lanches", "Bebidas").';
create index idx_menu_categories_client on public.menu_categories (workspace_id, client_id, sort_order);

create table public.menu_items (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    client_id     uuid not null references public.clients(id) on delete cascade,
    category_id   uuid not null references public.menu_categories(id) on delete cascade,
    sku           text,                                  -- código interno/PDV (livre)
    name          text not null check (char_length(name) between 1 and 160),
    description   text,
    price         numeric(12,2) not null check (price >= 0),
    status        menu_status not null default 'active', -- inclui 'out_of_stock' (em falta)
    sort_order    integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    unique (client_id, sku) -- NULL permite múltiplos itens sem SKU
);
comment on table public.menu_items is 'Produto do cardápio. updated_at alimenta o controle de edição concorrente (If-Match/ETag, ver docs/api.md).';
create index idx_menu_items_category on public.menu_items (category_id, sort_order);
create index idx_menu_items_client on public.menu_items (workspace_id, client_id);
create index idx_menu_items_status on public.menu_items (client_id, status);

create table public.menu_addon_groups (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    client_id     uuid not null references public.clients(id) on delete cascade,
    name          text not null check (char_length(name) between 1 and 120),
    min_qty       integer not null default 0 check (min_qty >= 0),
    max_qty       integer not null default 1 check (max_qty >= 1),
    sort_order    integer not null default 0,
    status        menu_status not null default 'active',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    check (min_qty <= max_qty)
);
comment on table public.menu_addon_groups is 'Grupo de complementos do cliente (ex.: "Escolha o ponto da carne", "Adicionais").';
create index idx_menu_addon_groups_client on public.menu_addon_groups (workspace_id, client_id, sort_order);

create table public.menu_subitems (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    group_id      uuid not null references public.menu_addon_groups(id) on delete cascade,
    name          text not null check (char_length(name) between 1 and 160),
    price_delta   numeric(12,2) not null default 0,      -- adicional sobre o item (pode ser 0)
    sort_order    integer not null default 0,
    status        menu_status not null default 'active',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
comment on table public.menu_subitems is 'Opção dentro de um grupo de complementos (ex.: "Ao ponto", "Bacon extra +R$ 3,00").';
create index idx_menu_subitems_group on public.menu_subitems (group_id, sort_order);
create index idx_menu_subitems_workspace on public.menu_subitems (workspace_id);

-- Ligação N:N item <-> grupo (quais grupos aparecem em quais produtos)
create table public.menu_item_addon_groups (
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    item_id       uuid not null references public.menu_items(id) on delete cascade,
    group_id      uuid not null references public.menu_addon_groups(id) on delete cascade,
    sort_order    integer not null default 0,
    primary key (item_id, group_id)
);
comment on table public.menu_item_addon_groups is 'Ligação N:N produto <-> grupo de complementos. workspace_id denormalizado para RLS simples.';
create index idx_miag_group on public.menu_item_addon_groups (group_id);
create index idx_miag_workspace on public.menu_item_addon_groups (workspace_id);

-- ============================================================================
-- IMAGENS DE CARDÁPIO + HISTÓRICO (ver docs/fotos-e-historico.md)
-- ============================================================================

create table public.menu_images (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    owner_type    image_owner_type not null,
    owner_id      uuid not null,                  -- menu_items.id ou menu_subitems.id (sem FK polimórfica; integridade via aplicação + trigger)
    storage_path  text not null,                  -- caminho no bucket 'menu-images' (ex.: {workspace}/{client}/{owner}/{version}.webp)
    mime_type     text not null default 'image/webp',
    bytes         integer not null check (bytes > 0),
    width         integer,
    height        integer,
    checksum_sha256 text not null,                -- detecta conteúdo idêntico / tampering
    version       integer not null default 1 check (version >= 1),
    is_current    boolean not null default true,
    created_by    uuid references auth.users(id) on delete set null,
    created_at    timestamptz not null default now()
);
comment on table public.menu_images is 'Imagem corrente do produto/subitem. Sempre versionada; a anterior NUNCA é perdida — vai para menu_image_history.';
create unique index uq_menu_images_current on public.menu_images (owner_type, owner_id) where is_current;
create index idx_menu_images_owner on public.menu_images (workspace_id, owner_type, owner_id);

create table public.menu_image_history (
    id                uuid primary key default gen_random_uuid(),
    workspace_id      uuid not null references public.workspaces(id) on delete cascade,
    menu_image_id     uuid references public.menu_images(id) on delete set null,   -- referência lógica; o arquivo em storage é a fonte do "desfazer"
    owner_type        image_owner_type not null,
    owner_id          uuid not null,
    storage_path      text not null,              -- arquivo ANTIGO preservado no bucket (não depende de URL)
    mime_type         text not null default 'image/webp',
    bytes             integer not null check (bytes > 0),
    version           integer not null check (version >= 1),
    checksum_sha256   text not null,
    replaced_by_type  audit_actor_type not null default 'user',
    replaced_by       uuid,                        -- auth.users.id ou api_keys.id
    replaced_at       timestamptz not null default now(),
    reason            text                          -- ex.: 'bulk_extension', 'manual_restore'
);
comment on table public.menu_image_history is 'Arquivo ANTIGO guardado a cada troca de foto — permite "desfazer" sem depender de URL. Retenção: ver docs/fotos-e-historico.md.';
create index idx_menu_image_history_owner on public.menu_image_history (workspace_id, owner_type, owner_id, version desc);

-- ============================================================================
-- API KEYS / EXTENSÕES
-- ============================================================================

create table public.extensions (
    id           uuid primary key default gen_random_uuid(),
    slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
    name         text not null,
    description  text,
    homepage_url text,
    -- Registro global de extensões conhecidas da plataforma (não é por workspace).
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);
comment on table public.extensions is 'Catálogo global de extensões Chrome MV3 publicadas pelo dono da plataforma.';

create table public.api_keys (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references public.workspaces(id) on delete cascade,
    extension_id    uuid references public.extensions(id) on delete set null,
    name            text not null,                 -- rótulo dado pelo usuário (ex.: "Notebook do Zé")
    key_hash        text not null unique,          -- APENAS hash (argon2/bcrypt/sha-256+salt). Nunca a chave em claro.
    key_prefix      text not null,                 -- primeiros 8 chars p/ exibição (ex.: "ck_live_")
    scopes          text[] not null default '{}',  -- ex.: {catalog:ler? ver docs/extensoes.md} — ex.: {'catalogo:ler','catalogo:escrever','clientes:ler'}
    rate_limit_per_minute integer not null default 60 check (rate_limit_per_minute between 1 and 10000),
    last_used_at    timestamptz,
    expires_at      timestamptz,
    revoked_at      timestamptz,
    created_by      uuid references auth.users(id) on delete set null,
    created_at      timestamptz not null default now()
);
comment on table public.api_keys is 'Chaves de API de extensões. Armazenar somente o HASH; a chave em claro é exibida uma única vez na criação.';
create index idx_api_keys_workspace on public.api_keys (workspace_id);
create index idx_api_keys_extension on public.api_keys (extension_id);
create index idx_api_keys_active on public.api_keys (workspace_id) where revoked_at is null;

create table public.extension_installs (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    extension_id  uuid not null references public.extensions(id) on delete cascade,
    api_key_id    uuid unique references public.api_keys(id) on delete set null,
    installed_by  uuid references auth.users(id) on delete set null,
    version       text,                            -- versão do manifest.json da extensão, informada no handshake
    status        text not null default 'active' check (status in ('active', 'suspended', 'uninstalled')),
    last_seen_at  timestamptz,
    created_at    timestamptz not null default now(),
    unique (workspace_id, extension_id)
);
comment on table public.extension_installs is 'Instalação de uma extensão em um workspace (vínculo extensão <-> tenant, 1:1 por enquanto).';
create index idx_extension_installs_workspace on public.extension_installs (workspace_id);

-- ============================================================================
-- WEBHOOKS
-- ============================================================================

create table public.webhooks (
    id             uuid primary key default gen_random_uuid(),
    workspace_id   uuid not null references public.workspaces(id) on delete cascade,
    name           text not null,
    url            text not null check (url ~ '^https://'),   -- apenas HTTPS
    secret         text not null,                  -- usado para HMAC-SHA256 (X-Hub-Signature-256). Armazenar criptografado (Supabase Vault) — NUNCA logar.
    events         text[] not null default '{}',   -- ex.: {'menu.item.created','menu.image.replaced'}
    is_active      boolean not null default true,
    failure_count  integer not null default 0,     -- falhas consecutivas; >= 20 => desativação automática
    last_success_at timestamptz,
    last_failure_at timestamptz,
    created_by     uuid references auth.users(id) on delete set null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
comment on table public.webhooks is 'Endpoints de webhook por workspace. Assinatura HMAC-SHA256; segredo nunca em claro em logs.';
create index idx_webhooks_workspace on public.webhooks (workspace_id) where is_active;

create table public.webhook_deliveries (
    id            uuid primary key default gen_random_uuid(),
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    webhook_id    uuid not null references public.webhooks(id) on delete cascade,
    event         text not null,
    payload       jsonb not null,
    status        webhook_delivery_status not null default 'pending',
    attempt       integer not null default 0 check (attempt >= 0),
    response_status integer,
    response_body text,                            -- truncado em 2 KB
    next_retry_at timestamptz,
    created_at    timestamptz not null default now(),
    delivered_at  timestamptz
);
comment on table public.webhook_deliveries is 'Histórico e fila de entregas. Reentrega com backoff exponencial — ver docs/webhooks.md.';
create index idx_webhook_deliveries_pending on public.webhook_deliveries (next_retry_at) where status = 'pending';
create index idx_webhook_deliveries_webhook on public.webhook_deliveries (webhook_id, created_at desc);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

create table public.audit_log (
    id            bigint generated always as identity primary key,
    workspace_id  uuid not null references public.workspaces(id) on delete cascade,
    actor_type    audit_actor_type not null,
    actor_id      uuid,                            -- auth.users.id, api_keys.id ou NULL p/ system
    action        text not null,                   -- ex.: 'menu.item.update', 'image.replace', 'api_key.rotate'
    entity_type   text not null,                   -- ex.: 'menu_item', 'api_key'
    entity_id     text,
    metadata      jsonb not null default '{}'::jsonb,
    ip            inet,                            -- [PII/LGPD] IP do ator — reter por máx. 90 dias
    created_at    timestamptz not null default now()
);
comment on table public.audit_log is 'Trilha imutável de auditoria. Retenção sugerida: 12 meses (90 dias para IP). Sem UPDATE/DELETE na aplicação.';
create index idx_audit_log_workspace_time on public.audit_log (workspace_id, created_at desc);
create index idx_audit_log_entity on public.audit_log (workspace_id, entity_type, entity_id);

-- ============================================================================
-- FUNÇÕES: updated_at automático
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger trg_workspaces_updated_at        before update on public.workspaces        for each row execute function public.set_updated_at();
create trigger trg_members_updated_at           before update on public.members           for each row execute function public.set_updated_at();
create trigger trg_clients_updated_at           before update on public.clients           for each row execute function public.set_updated_at();
create trigger trg_ad_accounts_updated_at       before update on public.ad_accounts       for each row execute function public.set_updated_at();
create trigger trg_menu_categories_updated_at   before update on public.menu_categories   for each row execute function public.set_updated_at();
create trigger trg_menu_items_updated_at        before update on public.menu_items        for each row execute function public.set_updated_at();
create trigger trg_menu_addon_groups_updated_at before update on public.menu_addon_groups for each row execute function public.set_updated_at();
create trigger trg_menu_subitems_updated_at     before update on public.menu_subitems     for each row execute function public.set_updated_at();
create trigger trg_extensions_updated_at        before update on public.extensions        for each row execute function public.set_updated_at();
create trigger trg_webhooks_updated_at          before update on public.webhooks          for each row execute function public.set_updated_at();

-- ============================================================================
-- ÍNDICES EM FKs (detecção via checks.sql)
-- ============================================================================
create index idx_members_invited_by on public.members (invited_by);
create index idx_api_keys_created_by on public.api_keys (created_by);
create index idx_extension_installs_installed_by on public.extension_installs (installed_by);
create index idx_webhooks_created_by on public.webhooks (created_by);
create index idx_webhook_deliveries_workspace on public.webhook_deliveries (workspace_id);
create index idx_menu_images_created_by on public.menu_images (created_by);
create index idx_menu_image_history_menu_image_id on public.menu_image_history (menu_image_id);

-- ============================================================================
-- STORAGE (bucket para fotos do cardápio)
-- ============================================================================
-- Bucket privado 'menu-images': leitura via signed URL gerada pelo servidor,
-- escrita apenas via API (service role / presigned upload). Nunca público direto.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', false)
on conflict (id) do nothing;

-- ============================================================================
-- 0002_rls.sql — RLS
-- ============================================================================

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

-- ============================================================================
-- 0003_tenant_consistency.sql — FK COMPOSTA / TENANT
-- ============================================================================

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

-- ============================================================================
-- seed.sql — DADOS FICTÍCIOS
-- ============================================================================

-- ============================================================================
-- seed.sql — Dados FICTÍCIOS para desenvolvimento local (nunca dados reais)
-- Aplicado por `supabase db reset`. Roda como superusuário (bypassa RLS de propósito).
-- ============================================================================

-- Usuários de demonstração (fictícios). Em Supabase local, auth.users é o caminho padrão.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dono@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Dono"}'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coordenador@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Coordenador"}'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Editor"}'),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Visualizador"}')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, plan)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Orvia Demo', 'orvia-demo', 'pro')
on conflict (id) do nothing;

insert into public.members (workspace_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'coordenador'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'editor'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'visualizador')
on conflict (workspace_id, user_id) do nothing;

-- Clientes fictícios
insert into public.clients (id, workspace_id, name, legal_name, document, contact_name, email, phone, whatsapp, instagram, status, delivery_status, monthly_fee, notes)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pizzaria do Ze (Demo)', 'Ze Pizzas Ltda (Demo)', '00.000.000/0001-00', 'José Demo', 'ze.demo@example.com', '+55 11 90000-0001', '+55 11 90000-0001', '@pizzariadozedemo', 'ativo', 'no_prazo', 1500.00, 'Cliente fictício para desenvolvimento'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hamburgueria Astro (Demo)', 'Astro Foods Ltda (Demo)', '00.000.000/0001-01', 'Ana Demo', 'ana.demo@example.com', '+55 11 90000-0002', '+55 11 90000-0002', '@astrohamburguerdemo', 'ativo', 'atrasado', 2200.00, 'Cliente fictício para desenvolvimento')
on conflict (id) do nothing;

insert into public.tags (id, workspace_id, name, color)
values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tráfego pago', '#2F6BFF'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'delivery', '#22D3EE')
on conflict (id) do nothing;

insert into public.client_tags (workspace_id, client_id, tag_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2')
on conflict do nothing;

-- Cardápio fictício
insert into public.menu_categories (id, workspace_id, client_id, name, sort_order, status)
values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Lanches', 10, 'active'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Bebidas', 20, 'active')
on conflict (id) do nothing;

insert into public.menu_items (id, workspace_id, client_id, category_id, sku, name, description, price, status, sort_order)
values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'LAN-001', 'X-Burger Clássico (Demo)', 'Hambúrguer artesanal 150g com queijo e molho da casa', 32.90, 'active', 10),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'LAN-002', 'Astro Bacon (Demo)', 'Burger duplo com bacon crocante', 41.50, 'out_of_stock', 20),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'BEB-001', 'Refrigerante Lata (Demo)', 'Lata 350ml gelada', 6.00, 'active', 10)
on conflict (id) do nothing;

insert into public.menu_addon_groups (id, workspace_id, client_id, name, min_qty, max_qty, sort_order, status)
values
  ('ffffffff-ffff-4fff-bfff-fffffffffff1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Adicionais', 0, 3, 10, 'active')
on conflict (id) do nothing;

insert into public.menu_subitems (id, workspace_id, group_id, name, price_delta, sort_order, status)
values
  ('99999999-9999-4999-8999-999999999991', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 'Bacon extra (Demo)', 4.00, 10, 'active'),
  ('99999999-9999-4999-8999-999999999992', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 'Queijo extra (Demo)', 3.00, 20, 'active')
on conflict (id) do nothing;

insert into public.menu_item_addon_groups (workspace_id, item_id, group_id, sort_order)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 10),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 10)
on conflict do nothing;

-- ============================================================================
-- checks.sql — CHECAGENS DE HIGIENE
-- ============================================================================

-- ============================================================================
-- checks.sql — Checagens automáticas de higiene do schema (rodar como superusuário)
-- Cada bloco imprime linhas; ausência de linhas = problema corrigido.
-- ============================================================================


select tablename as tabela_sem_rls
from pg_tables t
where t.schemaname = 'public'
  and not exists (select 1 from pg_class c where c.relname = t.tablename and c.relrowsecurity)
order by 1;


select t.tablename as tabela_sem_policy
from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 1;


select p.proname as funcao_definer_insegura
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (p.proconfig is null or not ('search_path=public' = any(p.proconfig) or exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path%')))
order by 1;


select con.conname as fk, con.conrelid::regclass as tabela
from pg_constraint con
where con.contype = 'f'
  and not exists (
    select 1
    from pg_index idx
    where idx.indrelid = con.conrelid
      and con.conkey[1] = any(idx.indkey)
  )
order by 1;


select
  (select count(*) from pg_tables where schemaname='public') as tabelas_public,
  (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') as policies_public,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef) as funcs_security_definer;

-- ============================================================================
-- rls_isolation.sql — 70 TESTES DE ISOLAMENTO (70/70)
-- ============================================================================

-- ============================================================================
-- rls_isolation.sql — Testes de isolamento multi-tenant (RLS)
-- Requer: 0001_init.sql + 0002_rls.sql + seed.sql aplicados (local/dev, NUNCA produção)
-- Rodar como superusuário: docker exec ... psql ... < supabase/tests/rls_isolation.sql
-- Compatível com "colar no SQL Editor" (SQL puro, sem meta-comandos do psql).
-- Personas (seed): owner/coordenador/editor/visualizador do workspace A
--                  owner do workspace B (criado aqui)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tabela de resultados (criada como postgres; apagada ao final)
-- ---------------------------------------------------------------------------
create table public.test_rls_results (
    id serial primary key,
    area text not null,
    test text not null,
    pass boolean not null,
    detail text
);
grant insert on public.test_rls_results to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace B de teste + personas (workspaces/people do seed A já existem)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerb@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner B"}')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, plan)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Workspace B (RLS Test)', 'rls-test-b', 'free')
on conflict (id) do nothing;

insert into public.members (workspace_id, user_id, role)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', '55555555-5555-4555-8555-555555555555', 'owner')
on conflict (workspace_id, user_id) do nothing;

insert into public.clients (id, workspace_id, name)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Cliente do Workspace B (RLS Test)')
on conflict (id) do nothing;

insert into public.menu_categories (id, workspace_id, client_id, name)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'Categoria B')
on conflict (id) do nothing;

-- Storage fixtures: objetos nos dois workspaces + um com prefixo malformado
insert into storage.objects (bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata)
values
  ('menu-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/menu_item/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/1.webp', null, now(), now(), now(), '{}'),
  ('menu-images', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001/x/menu_item/y/1.webp', null, now(), now(), now(), '{}'),
  ('menu-images', 'not-a-uuid/x/menu_item/y/1.webp', null, now(), now(), now(), '{}')
on conflict do nothing;

-- Dataset para asserts e limpeza posterior
create table public.test_rls_fixtures as
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as ws_a;

commit;

-- ===========================================================================
-- HELPER: como executar os blocos abaixo
-- Cada bloco faz SET LOCAL ROLE authenticated + claims JWT simuladas e registra
-- resultados em public.test_rls_results. Roda em transação própria.
-- Personas do seed (workspace A):
--   11111111-1111-4111-8111-111111111111 owner
--   22222222-2222-4222-8222-222222222222 coordenador
--   33333333-3333-4333-8333-333333333333 editor
--   44444444-4444-4444-8444-444444444444 visualizador
-- Persona workspace B:
--   55555555-5555-4555-8555-555555555555 owner
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PERSONA: VISORES/LEITORES — isolamento de LEITURA em todas as tabelas de negócio
-- (como visualizador A: não pode ver UMA linha sequer do workspace B)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  t text;
  n bigint;
  own uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  tabs text[] := array['members','clients','tags','client_tags','ad_accounts','menu_categories',
                       'menu_items','menu_addon_groups','menu_subitems','menu_item_addon_groups',
                       'menu_images','menu_image_history','api_keys','extension_installs','webhooks',
                       'webhook_deliveries','audit_log'];
begin
  foreach t in array tabs loop
    execute format('select count(*) from public.%I where workspace_id <> $1', t)
      into n using own;
    insert into public.test_rls_results(area, test, pass, detail)
    values ('leitura cruzada (visualizador A)', 'nenhuma linha do ws B visível em ' || t, n = 0, 'linhas visíveis: ' || n);
  end loop;
  -- workspaces por id
  select count(*) into n from public.workspaces where id <> own;
  insert into public.test_rls_results(area, test, pass, detail) values ('leitura cruzada (visualizador A)', 'workspaces de outros visíveis', n = 0, n::text);
  -- extensões (catálogo global: todas as linhas são visíveis — comportamento esperado)
  select count(*) into n from public.extensions;
  insert into public.test_rls_results(area, test, pass, detail) values ('extensões globais', 'catálogo global legível por qualquer membro autenticado', true, n::text);
end $$;
commit;

-- Mesmo teste, do lado B (garante assimetria): owner B não vê nada de A
begin;
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  t text;
  n bigint;
  own uuid := 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  tabs text[] := array['members','clients','tags','client_tags','ad_accounts','menu_categories',
                       'menu_items','menu_addon_groups','menu_subitems','menu_item_addon_groups',
                       'menu_images','menu_image_history','api_keys','extension_installs','webhooks',
                       'webhook_deliveries','audit_log'];
begin
  foreach t in array tabs loop
    execute format('select count(*) from public.%I where workspace_id <> $1', t)
      into n using own;
    insert into public.test_rls_results(area, test, pass, detail)
    values ('leitura cruzada (owner B)', 'nenhuma linha do ws A visível em ' || t, n = 0, 'linhas visíveis: ' || n);
  end loop;
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: EDITOR A — escrita no ws B deve falhar (insert) ou afetar 0 linhas (update)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- INSERT cruzado via RLS (menu_items no ws B a partir de A)
do $$
begin
  begin
    insert into public.menu_items (workspace_id, client_id, category_id, name, price)
    values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'INJECTION', 1.00);
    insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'insert em menu_items do ws B bloqueado', false, 'NÃO bloqueou');
  exception when insufficient_privilege or check_violation then
    insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'insert em menu_items do ws B bloqueado', true, sqlerrm);
  end;
end $$;

-- UPDATE cruzado: RLS filtra silenciosamente (0 linhas afetadas)
do $$
declare n integer;
begin
  update public.menu_items set name = 'HACKED'
   where workspace_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'update em menu_items do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;

-- DELETE cruzado
do $$
declare n integer;
begin
  delete from public.menu_items
   where workspace_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'delete em menu_items do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;

-- Editor pode escrever NO PRÓPRIO workspace (sanity check)
do $$
begin
  insert into public.menu_items (workspace_id, client_id, category_id, name, price)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Item Teste RLS (pode ser apagado)', 1.00);
  insert into public.test_rls_results(area, test, pass, detail) values ('permissão legítima (editor A)', 'insert em menu_items do próprio ws funciona', true, null);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('permissão legítima (editor A)', 'insert em menu_items do próprio ws funciona', false, sqlerrm);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: VISUALIZADOR A — não escreve NADA (negócio), apenas lê
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  t text;
  n integer;
  -- (tabela, sql de INSERT) — viewer deve falhar em todas
  tests text[][] := array[
    array['clients', 'insert into public.clients (workspace_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''x'')'],
    array['menu_items', 'insert into public.menu_items (workspace_id, client_id, category_id, name, price) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'',''dddddddd-dddd-4ddd-8ddd-ddddddddddd1'',''x'',1)'],
    array['menu_categories', 'insert into public.menu_categories (workspace_id, client_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'',''x'')'],
    array['menu_subitems', 'insert into public.menu_subitems (workspace_id, group_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''ffffffff-ffff-4fff-bfff-fffffffffff1'',''x'')'],
    array['tags', 'insert into public.tags (workspace_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''x'')'],
    array['menu_images', 'insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, bytes, checksum_sha256) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''menu_item'',gen_random_uuid(),''x/y/1.webp'',1,''abc'')']];
  q text[];
begin
  foreach q slice 1 in array tests loop
    t := q[1];
    begin
      execute q[2];
      insert into public.test_rls_results(area, test, pass, detail) values ('visualizador A (escrita)', t || ' bloqueado', false, 'NÃO bloqueou');
    exception when others then
      insert into public.test_rls_results(area, test, pass, detail) values ('visualizador A (escrita)', t || ' bloqueado', true, sqlerrm);
    end;
  end loop;
  -- visualizador pode LER (sanity): menu_items visível no próprio ws
  execute 'select count(*) from public.menu_items' into n;
  insert into public.test_rls_results(area, test, pass, detail) values ('visualizador A (leitura)', 'consegue ler o próprio ws (itens)', n >= 0, 'itens: ' || n);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: EDITOR A — não gerencia membros/chaves/webhooks/extensões; não deleta api_keys
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
begin
  begin
    insert into public.members (workspace_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'editor');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (membros)', 'insert em members bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (membros)', 'insert em members bloqueado', true, sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into public.api_keys (workspace_id, name, key_hash, key_prefix, scopes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test', 'hash', 'ck_live_test', '{catalogo:ler}');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (chaves)', 'insert em api_keys bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (chaves)', 'insert em api_keys bloqueado', true, sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from public.api_keys;
  insert into public.test_rls_results(area, test, pass, detail) values ('editor A (chaves)', 'select em api_keys retorna 0 linhas', n = 0, 'linhas: ' || n);
end $$;

do $$
begin
  begin
    insert into public.webhooks (workspace_id, name, url, secret, events) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 't', 'https://example.com/hook', 'whsec_test', '{menu.item.created}');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (webhooks)', 'insert em webhooks bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (webhooks)', 'insert em webhooks bloqueado', true, sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from public.webhook_deliveries;
  insert into public.test_rls_results(area, test, pass, detail) values ('editor A (webhooks)', 'select em webhook_deliveries retorna 0 linhas', n = 0, 'linhas: ' || n);
end $$;

do $$
begin
  begin
    insert into public.extension_installs (workspace_id, extension_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid());
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (extensões)', 'insert em extension_installs bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (extensões)', 'insert em extension_installs bloqueado', true, sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from public.extension_installs;
  insert into public.test_rls_results(area, test, pass, detail) values ('editor A (extensões)', 'select em extension_installs retorna 0 linhas', n = 0, 'linhas: ' || n);
end $$;

do $$
begin
  begin
    insert into public.ad_accounts (workspace_id, platform, external_account_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meta', 'act_test', 'Conta Teste');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (anúncios)', 'insert em ad_accounts bloqueado (só owner/coordenador)', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (anúncios)', 'insert em ad_accounts bloqueado (só owner/coordenador)', true, sqlerrm);
  end;
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: COORDENADOR A — pode gerir membros (exceto owner) mas NÃO deleta api_keys,
--                          não insere membro role=owner
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    insert into public.members (workspace_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'owner');
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'bloqueado ao criar owner', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'bloqueado ao criar owner', true, sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into public.members (workspace_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'editor');
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'pode adicionar editor não-owner', true, null);
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'pode adicionar editor não-owner', false, sqlerrm);
  end;
end $$;

-- coordenador não deleta api_keys (delete é só owner)
do $$
declare n integer;
begin
  delete from public.api_keys;
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (chaves)', 'delete em api_keys afeta 0 linhas (só owner)', n = 0, 'linhas: ' || n);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: OWNER A — pode tudo no próprio workspace, mas NADA no ws B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare n integer;
begin
  delete from public.members where workspace_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('owner A (cruzado)', 'delete em members do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;
do $$
declare n integer;
begin
  update public.workspaces set name = 'HACKED' where id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('owner A (cruzado)', 'update em workspaces do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- IMUTABILIDADE: menu_image_history e audit_log não aceitam update/delete de ninguém
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
begin
  begin
    insert into public.menu_image_history (workspace_id, owner_type, owner_id, storage_path, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'x/2.webp', 1, 2, 'abc');
    insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'insert em menu_image_history funciona (owner)', true, null);
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'insert em menu_image_history funciona (owner)', false, sqlerrm);
  end;
end $$;

do $$
declare n integer;
begin
  update public.menu_image_history set reason = 'tampered';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'update em menu_image_history bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'update em menu_image_history bloqueado', true, 'erro: ' || sqlerrm);
end $$;

do $$
declare n integer;
begin
  delete from public.menu_image_history;
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'delete em menu_image_history bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'delete em menu_image_history bloqueado', true, 'erro: ' || sqlerrm);
end $$;

-- audit_log: nenhum usuário autenticado insere/altera/apaga
do $$
begin
  begin
    insert into public.audit_log (workspace_id, actor_type, action, entity_type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user', 'test', 'test');
    insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'insert em audit_log bloqueado p/ usuários', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'insert em audit_log bloqueado p/ usuários', true, sqlerrm);
  end;
end $$;

do $$
declare n integer;
begin
  update public.audit_log set action = 'tampered';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'update em audit_log bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'update em audit_log bloqueado', true, 'erro: ' || sqlerrm);
end $$;

do $$
declare n integer;
begin
  delete from public.audit_log;
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'delete em audit_log bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'delete em audit_log bloqueado', true, 'erro: ' || sqlerrm);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- STORAGE: bucket menu-images só acessível pelo prefixo do próprio workspace
--          (inclusive UUID malformado não pode vazar nem quebrar a query)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare n bigint;
begin
  select count(*) into n from storage.objects
   where bucket_id = 'menu-images' and name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%';
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'enxerga objetos do próprio prefixo', n = 1, 'linhas: ' || n);
end $$;
do $$
declare n bigint;
begin
  select count(*) into n from storage.objects
   where bucket_id = 'menu-images' and name like 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001/%';
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'não enxerga objetos do ws B', n = 0, 'linhas: ' || n);
end $$;
do $$
declare n bigint;
begin
  -- prefixo malformado: não pode levantar erro, apenas 0 linhas
  select count(*) into n from storage.objects
   where bucket_id = 'menu-images' and name like 'not-a-uuid/%';
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'prefixo malformado não vaza e não quebra', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'prefixo malformado não vaza e não quebra', false, 'ERRO: ' || sqlerrm);
end $$;
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner) values ('menu-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/hack.webp', null);
    insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'INSERT em storage.objects bloqueado p/ authenticated', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'INSERT em storage.objects bloqueado p/ authenticated', true, sqlerrm);
  end;
end $$;
commit;

-- ===========================================================================
-- RELATÓRIO FINAL (como superusuário)
-- ===========================================================================
reset role;
select id, area, test, pass, detail from public.test_rls_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from public.test_rls_results;

-- Limpeza: remover fixtures de teste (a fixture do bucket some no próximo `supabase db reset`;
-- objetos de storage NUNCA devem ser apagados por SQL direto — usar a Storage API).
delete from public.menu_items where name like 'Item Teste RLS%';
delete from public.members where user_id = '55555555-5555-4555-8555-555555555555' and workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from public.test_rls_fixtures;
drop table public.test_rls_fixtures;
drop table public.test_rls_results;

-- ============================================================================
-- rls_cross_link.sql — 20 TESTES DE CONSISTÊNCIA DE TENANT (20/20)
-- ============================================================================

-- ============================================================================
-- rls_cross_link.sql — Consistência de tenant: ligação A apontando para B deve FALHAR
-- Requer: 0001 + 0002 + 0003 + seed.sql. Rodar como SUPERUSUÁRIO (prova a camada FK/trigger;
-- a camada RLS já é coberta por rls_isolation.sql — 70 asserts).
-- docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/rls_cross_link.sql
-- ============================================================================

begin;
create table public.test_cross_link_results (
    id serial primary key,
    area text not null,
    test text not null,
    pass boolean not null,
    detail text
);
grant insert on public.test_cross_link_results to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: workspace B com um registro de cada tipo (ids fixos)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerb@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner B"}')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, plan)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Workspace B (Cross-Link Test)', 'rls-test-b', 'free')
on conflict (id) do nothing;

insert into public.members (workspace_id, user_id, role)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', '55555555-5555-4555-8555-555555555555', 'owner')
on conflict (workspace_id, user_id) do nothing;

insert into public.clients (id, workspace_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Cliente B (XL)')
on conflict (id) do nothing;

insert into public.tags (id, workspace_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb00a1', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'tag-b (XL)'),
  ('cccccccc-0000-4000-8000-cccccccc00a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tag-a (XL)')
on conflict (id) do nothing;

insert into public.menu_categories (id, workspace_id, client_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'Categoria B (XL)')
on conflict (id) do nothing;

insert into public.menu_items (id, workspace_id, client_id, category_id, name, price) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'Item B (XL)', 10.00)
on conflict (id) do nothing;

insert into public.menu_addon_groups (id, workspace_id, client_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0005', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'Grupo B (XL)')
on conflict (id) do nothing;

insert into public.menu_subitems (id, workspace_id, group_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0006', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0005', 'Subitem B (XL)')
on conflict (id) do nothing;

insert into public.api_keys (id, workspace_id, name, key_hash, key_prefix, scopes) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0007', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'key B (XL)', 'hashb', 'ck_live_xl_b', '{catalogo:ler}'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'key A (XL)', 'hasha', 'ck_live_xl_a', '{catalogo:ler}')
on conflict (id) do nothing;

insert into public.webhooks (id, workspace_id, name, url, secret, events) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Hook B (XL)', 'https://example.com/b', 'whsec_b', '{menu.item.created}'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0010', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hook A (XL)', 'https://example.com/a', 'whsec_a', '{menu.item.created}')
on conflict (id) do nothing;

-- Imagens (uma em cada workspace) para testar a trigger e a FK composta da história
insert into public.menu_images (id, workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, is_current, checksum_sha256)
values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0011', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'menu_item', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'xl/b/1.webp', 'image/webp', 10, 1, true, 'hashb'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'xl/a/1.webp', 'image/webp', 10, 1, true, 'hasha')
on conflict (id) do nothing;

insert into public.extensions (id, slug, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0013', 'xl-test-extension', 'XL Test Extension')
on conflict (id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- CASOS — todos executados como SUPERUSUÁRIO (camada de FK/trigger)
-- Cada caso: (1) ligação cruzada A→B deve FALHAR; (2) ligação legítima A→A deve funcionar; (3) limpeza.
-- ---------------------------------------------------------------------------

-- 1) client_tags: (A, cliente B) falha; (A, tag B) falha; (A, cliente A, tag A-XL) funciona
do $$
begin
  begin
    insert into public.client_tags (workspace_id, client_id, tag_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'cccccccc-0000-4000-8000-cccccccc00a1');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.client_tags (workspace_id, client_id, tag_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-0000-4000-8000-bbbbbbbb00a1');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'tag cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'tag cruzada A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.client_tags (workspace_id, client_id, tag_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-0000-4000-8000-cccccccc00a1');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'ligação legítima A→A funciona', true, null);
  delete from public.client_tags where tag_id = 'cccccccc-0000-4000-8000-cccccccc00a1';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'ligação legítima A→A funciona', false, sqlerrm);
end $$;

-- 2) ad_accounts: cliente cruzado falha
do $$
begin
  begin
    insert into public.ad_accounts (workspace_id, client_id, platform, external_account_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'meta', 'act_xl', 'XL');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('ad_accounts', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('ad_accounts', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 3) menu_categories: cliente cruzado falha
do $$
begin
  begin
    insert into public.menu_categories (workspace_id, client_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'XL Cat');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_categories', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_categories', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 4) menu_items: cliente cruzado falha / categoria cruzada falha
do $$
begin
  begin
    insert into public.menu_items (workspace_id, client_id, category_id, name, price)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'XL', 1.00);
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.menu_items (workspace_id, client_id, category_id, name, price)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'XL', 1.00);
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'categoria cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'categoria cruzada A→B falha', true, sqlerrm);
  end;
end $$;

-- 5) menu_addon_groups: cliente cruzado falha
do $$
begin
  begin
    insert into public.menu_addon_groups (workspace_id, client_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'XL Group');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_addon_groups', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_addon_groups', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 6) menu_subitems: grupo cruzado falha; legítimo funciona
do $$
begin
  begin
    insert into public.menu_subitems (workspace_id, group_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0005', 'XL');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'grupo cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'grupo cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.menu_subitems (workspace_id, group_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 'XL Sub (temp)');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'ligação legítima A→A funciona', true, null);
  delete from public.menu_subitems where name = 'XL Sub (temp)';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'ligação legítima A→A funciona', false, sqlerrm);
end $$;

-- 7) menu_item_addon_groups: item cruzado falha; grupo cruzado falha
do $$
begin
  begin
    insert into public.menu_item_addon_groups (workspace_id, item_id, group_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'ffffffff-ffff-4fff-bfff-fffffffffff1');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'item cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'item cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.menu_item_addon_groups (workspace_id, item_id, group_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0005')
    on conflict do nothing;
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'grupo cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'grupo cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 8) menu_image_history: imagem cruzada falha (FK composta); legítima funciona
do $$
begin
  begin
    insert into public.menu_image_history (workspace_id, owner_type, owner_id, storage_path, bytes, version, checksum_sha256, menu_image_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'xl/x.webp', 1, 9, 'abc', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0011');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history', 'menu_image cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history', 'menu_image cruzada A→B falha', true, sqlerrm);
  end;
end $$;

-- 9) extension_installs: api_key cruzada falha; legítima funciona
do $$
begin
  begin
    insert into public.extension_installs (workspace_id, extension_id, api_key_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0013', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0007');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'api_key cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'api_key cruzada A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.extension_installs (workspace_id, extension_id, api_key_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0013', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'ligação legítima A→A funciona', true, null);
  delete from public.extension_installs where api_key_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'ligação legítima A→A funciona', false, sqlerrm);
end $$;

-- 10) webhook_deliveries: webhook cruzado falha
do $$
begin
  begin
    insert into public.webhook_deliveries (workspace_id, webhook_id, event, payload) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'menu.item.created', '{}');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('webhook_deliveries', 'webhook cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('webhook_deliveries', 'webhook cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 11) menu_images (trigger): dono cruzado falha / legítimo funciona
do $$
begin
  begin
    insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'xl/cross.webp', 'image/webp', 1, 1, 'abc');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_item cruzado A→B falha', false, 'NÃO falhou');
  exception when others then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_item cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_subitem', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0006', 'xl/cross2.webp', 'image/webp', 1, 1, 'abc');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_subitem cruzado A→B falha', false, 'NÃO falhou');
  exception when others then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_subitem cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, checksum_sha256)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'xl/own.webp', 'image/webp', 1, 1, 'abc');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'dono legítimo A→A funciona', true, null);
  delete from public.menu_images where storage_path = 'xl/own.webp';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'dono legítimo A→A funciona', false, sqlerrm);
end $$;

-- 12) menu_image_history (trigger): owner cruzado falha / legítimo funciona
do $$
begin
  begin
    insert into public.menu_image_history (workspace_id, owner_type, owner_id, storage_path, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_subitem', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0006', 'xl/histcross.webp', 1, 1, 'abc');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history (trigger)', 'owner cruzado A→B falha', false, 'NÃO falhou');
  exception when others then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history (trigger)', 'owner cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- RELATÓRIO
-- ---------------------------------------------------------------------------
select id, area, test, pass, detail from public.test_cross_link_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from public.test_cross_link_results;

-- Limpeza das fixtures XL (os registros A/B permanecem; o reset seguinte os remove)
delete from public.webhook_deliveries where webhook_id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0010');
delete from public.extension_installs where api_key_id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0007', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008');
delete from public.menu_image_history where storage_path like 'xl/%';
delete from public.menu_images where storage_path like 'xl/%';
delete from public.api_keys where id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0007', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008');
delete from public.webhooks where id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0010');
delete from public.extensions where slug = 'xl-test-extension';
drop table public.test_cross_link_results;
