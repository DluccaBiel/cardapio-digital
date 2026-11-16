-- ============================================================================
-- 20261116152908_add_client_niche_website.sql — Add niche and website to clients
-- ============================================================================
-- LEMBRETE OPERACIONAL: faça BACKUP do banco antes de rodar qualquer migração
-- em produção (supabase db dump ou snapshot do projeto no dashboard).
-- ============================================================================

-- Add niche column to clients (food or health)
alter table public.clients
add column if not exists niche text
check (niche in ('food', 'health')) default 'food';

-- Add website column to clients
alter table public.clients
add column if not exists website text;

-- Add comment on columns
comment on column public.clients.niche is 'Nicho de atuação do cliente: food (alimentação) ou health (saúde)';
comment on column public.clients.website is 'Website do cliente (URL)';

-- Create index on niche for search performance
create index if not exists idx_clients_niche on public.clients (workspace_id, niche) where archived_at is null;