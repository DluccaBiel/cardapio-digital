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
-- STORAGE (bucket para fotos do cardápio)
-- ============================================================================
-- Bucket privado 'menu-images': leitura via signed URL gerada pelo servidor,
-- escrita apenas via API (service role / presigned upload). Nunca público direto.
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', false)
on conflict (id) do nothing;
