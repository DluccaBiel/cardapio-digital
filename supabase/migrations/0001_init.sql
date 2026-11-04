-- ============================================================================
# SCHEMA INICIAL - FASE 1
# Cardápio Web Hub - Multi-tenant Workspace
# ============================================================================

-- Habilitar extensão UUID
create extension if not exists "uuid-ossp";

-- ============================================================================
-- 1. WORKSPACES (Multi-tenant)
-- ============================================================================
create table public.workspaces (
    id uuid primary key default uuid_generate_v4(),
    nome text not null,
    slug text not null unique,
    plano text default 'gratuito', -- gratuito, pro, empresarial
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 2. PERFIS / MEMBROS
-- ============================================================================
create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique,
    email text,
    role text default 'cliente', -- admin, cliente
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.workspace_members (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role text not null check (role in ('owner','coordenador','editor','visualizador')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique (workspace_id, user_id)
);

-- ============================================================================
-- 3. CLIENTES
-- ============================================================================
create table public.clients (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,
    email text,                       -- dado pessoal (LGPD)
    telefone text,                    -- dado pessoal (LGPD)
    documento text,                   -- dado pessoal sensível (LGPD)
    status text default 'ativo',      -- ativo, inativo, bloqueado
    categoria text,
    observacoes text,
    gasto_total numeric default 0,
    saldo numeric default 0,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    atualizado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 4. TAGS e CLIENT_TAGS
-- ============================================================================
create table public.tags (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,
    cor text default '#6BEA57',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.client_tags (
    id uuid primary key default uuid_generate_v4(),
    client_id uuid not null references public.clients(id) on delete cascade,
    tag_id uuid not null references public.tags(id) on delete cascade,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique (client_id, tag_id)
);

-- ============================================================================
-- 5. CONTAS DE ANÚNCIO (META)
-- ============================================================================
create table public.ad_accounts (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    client_id uuid references public.clients(id) on delete set null,
    nome text not null,
    meta_ad_account_id text not null, -- ID da conta no Meta
    access_token text,                -- criptografar antes de guardar
    saldo numeric default 0,
    gasto_total numeric default 0,
    status text default 'ativo',      -- ativo, inativo, pendente
    acompanhar boolean default false,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 6. CARDÁPIO - CATEGORIAS
-- ============================================================================
create table public.menu_categories (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,
    slug text not null,
    ordem integer default 0,
    ativo boolean default true,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique (workspace_id, slug)
);

-- ============================================================================
-- 7. CARDÁPIO - PRODUTOS
-- ============================================================================
create table public.menu_items (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    category_id uuid references public.menu_categories(id) on delete set null,
    nome text not null,
    descricao text,
    preco numeric default 0,
    preco_referencia numeric,         -- preço da concorrência para comparação
    categoria_mercado text,           -- abaixo / ideal / acima
    status text default 'ativo',      -- ativo, inativo, em_falta
    categoria text,                   -- categoria textual (legado/filtro)
    imagem_url text,                  -- URL da imagem no Supabase Storage
    otimizado boolean default false,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    atualizado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 8. CARDÁPIO - GRUPOS DE COMPLEMENTOS (ADDON GROUPS)
-- ============================================================================
create table public.menu_addon_groups (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,
    obrigatorio boolean default false,
    minimo integer default 0,
    maximo integer default 0,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 9. CARDÁPIO - SUBITENS (OPÇÕES DE PRODUTO)
-- ============================================================================
create table public.menu_subitems (
    id uuid primary key default uuid_generate_v4(),
    addon_group_id uuid not null references public.menu_addon_groups(id) on delete cascade,
    produto_id uuid references public.menu_items(id) on delete cascade, -- opcional: vincula a um produto específico
    nome text not null,
    preco_adicional numeric default 0,
    ativo boolean default true,
    ordem integer default 0,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 10. CARDÁPIO - IMAGENS e HISTÓRICO
-- ============================================================================
create table public.menu_images (
    id uuid primary key default uuid_generate_v4(),
    produto_id uuid references public.menu_items(id) on delete cascade,
    user_id uuid references auth.users(id),
    url text not null,                -- URL pública do Supabase Storage
    storage_path text not null,       -- caminho interno no bucket
    bucket text default 'produto-imagens',
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.menu_image_history (
    id uuid primary key default uuid_generate_v4(),
    produto_id uuid not null references public.menu_items(id) on delete cascade,
    user_id uuid references auth.users(id),
    url text not null,                -- URL da imagem armazenada (não apenas referência)
    storage_path text not null,
    bucket text default 'produto-imagens',
    acao text not null check (acao in ('inserir','alterar','excluir','restaurar')),
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 11. API KEYS (EXTENSÕES)
-- ============================================================================
create table public.api_keys (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,               -- apelido da chave dado pelo usuário
    key_hash text not null unique,    -- hash da chave (bcrypt/argon2)
    prefixo text not null,            -- prefixo visível (ex: card_live_...)
    escopos text[] default '{}',      -- ex: {catalogo:ler, catalogo:escrever}
    ultimo_uso timestamp with time zone,
    requisicoes_hoje integer default 0,
    limite_requisicoes_dia integer default 1000,
    ativo boolean default true,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    expirado_em timestamp with time zone
);

-- ============================================================================
-- 12. EXTENSÕES INSTALADAS
-- ============================================================================
create table public.extensions (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,
    versao text,
    extensao_id text,                 -- ID da extensão Chrome (chrome-extension://...)
    ativa boolean default true,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 13. WEBHOOKS
-- ============================================================================
create table public.webhooks (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    nome text not null,
    url text not null,
    secreto text not null,            -- chave para assinatura HMAC
    eventos text[] default '{}',      -- ex: {menu.item.created, menu.image.replaced}
    ativo boolean default true,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table public.webhook_deliveries (
    id uuid primary key default uuid_generate_v4(),
    webhook_id uuid not null references public.webhooks(id) on delete cascade,
    evento text not null,
    payload jsonb not null,
    status_code integer,
    resposta text,
    tentativas integer default 0,
    enviado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- 14. AUDIT LOG
-- ============================================================================
create table public.audit_log (
    id uuid primary key default uuid_generate_v4(),
    workspace_id uuid references public.workspaces(id) on delete set null,
    user_id uuid references auth.users(id) on delete set null,
    acao text not null,
    entidade text not null,
    entidade_id uuid,
    valores_antigos jsonb,
    valores_novos jsonb,
    ip text,
    user_agent text,
    criado_em timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ============================================================================
-- ÍNDICES
-- ============================================================================
create index idx_produtos_usuario_id on public.produtos(user_id);
create index idx_produtos_categoria on public.produtos(categoria);
create index idx_produtos_status_mercado on public.produtos(status_mercado);
create index idx_relatorios_user_id on public.relatorios(user_id);
create index idx_relatorio_itens_relatorio_id on public.relatorio_itens(relatorio_id);
create index idx_produtos_preco_referencia on public.produtos(preco_referencia);

-- ============================================================================
-- COMENTÁRIOS LGPD
-- ============================================================================
-- Colunas com dados pessoais (LGPD):
-- public.produtos.nome (não é dado pessoal)
-- public.produtos.descricao (não é dado pessoal)
-- public.clientes.nome, email, telefone, documento -> DADOS PESSOAIS (LGPD)
-- public.produtos.imagem_url -> pode conter imagem de pessoa (LGPD)
-- Retenção: documentos e dados pessoais devem ser excluídos quando o cliente for removido (cascade).
