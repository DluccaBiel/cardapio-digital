-- ============================================================================
-- 0005_menu_optimizations.sql — Histórico de otimizações feitas pela extensão
-- Pré-requisito: 0001..0004 (não editados). BACKUP antes de aplicar em produção.
--
--   menu_optimizations          1 linha por execução aprovada (plano congelado + resultado)
--   menu_optimization_evidence  prints (PNG) "print 1..3" enviados pela extensão
--   bucket privado 'optimization-evidence' (leitura via URL assinada gerada no servidor)
--
-- Regras do repo aplicadas (ver 0003_tenant_consistency.sql):
--   * FKs COMPOSTAS (workspace_id, x) → pai (workspace_id, id): impede linha do
--     workspace A apontar para cliente/otimização/chave do workspace B.
--   * RLS ligada; leitura para membros do workspace; escrita só service role
--     (API com X-API-Key) — sem policy de insert/update/delete.
--   * Toda FK com índice cuja 1ª coluna é a referenciante (checks.sql §4).
-- Aditiva: só cria tabelas/índices/policies/bucket novos. Nada é apagado.
-- ============================================================================

create table if not exists public.menu_optimizations (
    id             uuid primary key default gen_random_uuid(),
    workspace_id   uuid not null references public.workspaces(id) on delete cascade,
    client_id      uuid not null,
    plan_hash      text not null check (char_length(plan_hash) between 3 and 64),
    version        int  not null default 1 check (version between 1 and 99),
    summary        text not null default '' check (char_length(summary) <= 2000),
    aborted        boolean not null default false,
    approved       jsonb not null default '[]'::jsonb,
    results        jsonb not null default '[]'::jsonb,
    ok_count       int not null default 0 check (ok_count >= 0),
    error_count    int not null default 0 check (error_count >= 0),
    created_by_key uuid,
    created_at     timestamptz not null default now(),
    constraint uq_menu_optimizations_ws_id unique (workspace_id, id),
    constraint menu_optimizations_ws_client_fkey
        foreign key (workspace_id, client_id) references public.clients (workspace_id, id) on delete cascade,
    -- chave revogada/apagada não apaga o histórico: só zera a autoria (PG 15+)
    constraint menu_optimizations_ws_key_fkey
        foreign key (workspace_id, created_by_key) references public.api_keys (workspace_id, id) on delete set null (created_by_key)
);
comment on table public.menu_optimizations is 'Otimizações de cardápio aprovadas e aplicadas pela extensão iFood (plano congelado + status por alteração).';
create index if not exists idx_menu_optimizations_client
    on public.menu_optimizations (workspace_id, client_id, created_at desc);
create index if not exists idx_menu_optimizations_key
    on public.menu_optimizations (workspace_id, created_by_key) where created_by_key is not null;

create table if not exists public.menu_optimization_evidence (
    id              uuid primary key default gen_random_uuid(),
    workspace_id    uuid not null references public.workspaces(id) on delete cascade,
    optimization_id uuid not null,
    name            text not null check (name ~ '^[A-Za-z0-9 ._()-]{1,80}$'),
    storage_path    text not null,                -- {workspace}/{client}/{optimization}/{arquivo}.png no bucket 'optimization-evidence'
    bytes           int  not null check (bytes between 1 and 3000000),
    created_at      timestamptz not null default now(),
    constraint menu_opt_evidence_ws_opt_fkey
        foreign key (workspace_id, optimization_id) references public.menu_optimizations (workspace_id, id) on delete cascade
);
comment on table public.menu_optimization_evidence is 'Prints (PNG) enviados pela extensão como evidência da otimização. Arquivo no Storage privado.';
create index if not exists idx_menu_opt_evidence_opt
    on public.menu_optimization_evidence (workspace_id, optimization_id);

alter table public.menu_optimizations         enable row level security;
alter table public.menu_optimization_evidence enable row level security;

drop policy if exists menu_optimizations_select on public.menu_optimizations;
create policy menu_optimizations_select on public.menu_optimizations
    for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists menu_opt_evidence_select on public.menu_optimization_evidence;
create policy menu_opt_evidence_select on public.menu_optimization_evidence
    for select to authenticated using (public.is_workspace_member(workspace_id));
-- escrita: somente service role (API com X-API-Key) — sem policy de insert/update/delete.

-- Bucket privado. Sem policy em storage.objects: só o servidor (service role) lê/grava;
-- o painel/extensão recebem URL assinada (10 min) via GET /api/v1/optimizations.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('optimization-evidence', 'optimization-evidence', false, 3000000, array['image/png'])
on conflict (id) do nothing;
