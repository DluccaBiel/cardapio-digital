-- ============================================================================
-- 0010_flyto_channel.sql — Parceiro FlyTo: quarto canal de integração
-- Pré-requisitos: 0001..0009 (não editados). BACKUP antes de aplicar em produção.
--
--   1) Catálogo global de extensões: registra a extensão 'orvia-flyto'
--      (slug usado pelo código da extensão do parceiro e pelo código de conexão).
--   2) clients.flyto_store_id — trava de loja própria do FlyTo.
--   3) menu_optimizations.platform passa a aceitar 'flyto'.
--
-- Aditiva: só adiciona coluna/índice/linha de catálogo e amplia um CHECK.
-- RLS: nenhuma tabela nova; as policies existentes seguem valendo.
-- ============================================================================

-- 1) Catálogo global de extensões
insert into public.extensions (slug, name, description, homepage_url)
values (
    'orvia-flyto',
    'Undercut · FlyTo',
    'Conecta o sistema FlyTo ao Undercut: lê o cardápio do parceiro, envia ao hub e guia a otimização com os donos da operação.',
    null
)
on conflict (slug) do nothing;

-- 2) Trava de loja do FlyTo (independente das do iFood, Cardápio Web e Anota AI)
alter table public.clients add column if not exists flyto_store_id text;
comment on column public.clients.flyto_store_id is 'ID da loja no FlyTo (informado pela extensão). Impede importar cardápio de outra loja.';
create unique index if not exists uq_clients_flyto_store
    on public.clients (workspace_id, flyto_store_id) where flyto_store_id is not null;

-- 3) Canal de cada otimização enviada: amplia o CHECK criado na 0006/0008
alter table public.menu_optimizations drop constraint if exists menu_optimizations_platform_check;
alter table public.menu_optimizations
    add constraint menu_optimizations_platform_check check (platform in ('ifood', 'cardapioweb', 'anotaai', 'flyto'));
comment on column public.menu_optimizations.platform is 'Canal de origem: ifood, cardapioweb, anotaai ou flyto (extensão/parceiro da chave).';
