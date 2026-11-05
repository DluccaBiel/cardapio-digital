-- ============================================================================
-- 0005_clients_extended.sql — Visão geral: campos da tabela de referência
-- Pré-requisito: 0001_init.sql + 0002_rls.sql + 0003_tenant_consistency.sql
--
-- Adiciona em `clients`: segmento, situação (ativo/onboarding/stand_by/churn),
-- estado da campanha, status do criativo, estado de entrega, editor,
-- término, alerta, último PIX, rotina semanal e last_change_at (badge).
-- Não altera tabelas existentes além de `clients`. RLS inalterada (a policy
-- de clients já cobre leitura/escrita pelos papéis).
-- ============================================================================

-- Situação exibida no painel (chips Ativos/Onboarding/Stand-by/Churn)
create type client_situation as enum ('ativo', 'onboarding', 'stand_by', 'churn');
comment on type client_situation is 'Situação do cliente no painel (chips da Visão geral).';

alter table public.clients
    add column segment text not null default '',
    add column situation client_situation not null default 'ativo',
    add column campaign_state text not null default 'nao_definido'
        check (campaign_state in ('nao_definido', 'planejamento', 'ativo', 'pausado', 'encerrado')),
    add column creative_status text not null default 'nao_definido'
        check (creative_status in ('nao_definido', 'em_producao', 'estatico_pronto', 'video_pronto', 'em_aprovacao')),
    add column delivery_state text not null default 'pendente'
        check (delivery_state in ('pendente', 'estatico_pronto', 'video_pronto', 'sem_criativo', 'entregue')),
    add column editor text not null default '',          -- nome do responsável (chip); livre
    add column termination_date date,                    -- término do ciclo/contrato
    add column last_change_at timestamptz not null default now(),
    add column has_alert boolean not null default false, -- ponto vermelho ao lado do nome
    add column pix_paid_at timestamptz,                  -- último PIX registrado
    add column pix_amount numeric(12,2) check (pix_amount is null or pix_amount >= 0),
    add column routine_week text,                        -- ISO week em que a rotina foi marcada (ex.: '2026-W45')
    add column routine_report boolean not null default false,
    add column routine_upload boolean not null default false,
    add column routine_ia boolean not null default false,
    add column routine_share boolean not null default false,
    add column routine_note boolean not null default false,
    add column routine_camera boolean not null default false;

comment on column public.clients.segment is 'Segmento do cliente (ex.: Hamburgueria, Pizzaria) — usado na busca.';
comment on column public.clients.has_alert is 'Ponto vermelho ao lado do nome na tabela (pendência do cliente).';
comment on column public.clients.last_change_at is 'Última alteração do cliente — usado no badge "ontem / há N dias".';
comment on column public.clients.routine_week is 'ISO week da última marcação da rotina; se difere da semana atual, a rotina aparece zerada.';

-- last_change_at automático
create or replace function public.set_last_change_at()
returns trigger
language plpgsql
as $$
begin
    new.last_change_at := now();
    return new;
end $$;

drop trigger if exists trg_clients_last_change_at on public.clients;
create trigger trg_clients_last_change_at
    before insert or update on public.clients
    for each row execute function public.set_last_change_at();

create index if not exists idx_clients_situation on public.clients (workspace_id, situation);
create index if not exists idx_clients_last_change on public.clients (workspace_id, last_change_at desc);
create index if not exists idx_clients_editor on public.clients (workspace_id, editor);
create index if not exists idx_clients_campaign_state on public.clients (workspace_id, campaign_state);

-- Backfill do campo legado (projeto novo está vazio; mantém coerência se já houver linhas)
update public.clients
set situation = case status
    when 'pausado' then 'stand_by'::client_situation
    when 'encerrado' then 'churn'::client_situation
    else 'ativo'::client_situation
end;
