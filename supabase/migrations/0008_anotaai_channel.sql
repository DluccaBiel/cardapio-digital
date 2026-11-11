-- ============================================================================
-- 0008_anotaai_channel.sql — Terceiro canal: extensão Anota AI
-- Pré-requisito: 0001..0007 (não editados). BACKUP antes de aplicar em produção.
--
--   1) Catálogo: registra a extensão 'orvia-anotaai' (login/código de conexão
--      gerado para ela vira chave vinculada a ela → canal 'anotaai').
--   2) clients.anotaai_store_id — trava de loja própria do Anota AI.
--   3) menu_optimizations.platform passa a aceitar 'anotaai'.
--
-- Aditiva: só adiciona coluna/índice/linha de catálogo e amplia um CHECK.
-- RLS: nenhuma tabela nova; as policies existentes seguem valendo.
-- ============================================================================

-- 1) Catálogo global de extensões
insert into public.extensions (slug, name, description, homepage_url)
values (
    'orvia-anotaai',
    'Orvia · Otimizador Anota AI',
    'Sincroniza o cardápio do painel do Anota AI, analisa com o Orvia, aplica o que você aprovar e envia o relatório com prints.',
    null
)
on conflict (slug) do nothing;

-- 2) Trava de loja do Anota AI (independente das do iFood e do Cardápio Web)
alter table public.clients add column if not exists anotaai_store_id text;
comment on column public.clients.anotaai_store_id is 'ID da loja no Anota AI (informado pela extensão). Impede importar cardápio de outra loja.';
create unique index if not exists uq_clients_anotaai_store
    on public.clients (workspace_id, anotaai_store_id) where anotaai_store_id is not null;

-- 3) Canal de cada otimização enviada: amplia o CHECK criado na 0006
alter table public.menu_optimizations drop constraint if exists menu_optimizations_platform_check;
alter table public.menu_optimizations
    add constraint menu_optimizations_platform_check check (platform in ('ifood', 'cardapioweb', 'anotaai'));
comment on column public.menu_optimizations.platform is 'Canal de origem: ifood, cardapioweb ou anotaai (extensão da chave).';
