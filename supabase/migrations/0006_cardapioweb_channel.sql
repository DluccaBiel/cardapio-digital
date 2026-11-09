-- ============================================================================
-- 0006_cardapioweb_channel.sql — Segundo canal: extensão Cardápio Web
-- Pré-requisito: 0001..0005 (não editados). BACKUP antes de aplicar em produção.
--
--   1) Catálogo: registra a extensão 'orvia-cardapioweb'. O login feito DENTRO
--      dela passa a gerar chave vinculada a ela (antes caía em 'orvia-ifood').
--   2) clients.cardapioweb_store_id — trava de loja própria do Cardápio Web.
--      Antes a extensão gravava o id da loja do Cardápio Web em ifood_merchant_id,
--      travando o cliente para o iFood (e gerando cliente duplicado depois).
--   3) menu_optimizations.platform ('ifood' | 'cardapioweb') — separa o
--      relatório/prints por canal no painel. Linhas antigas ficam 'ifood'
--      (não há como distinguir com segurança o que veio antes desta migration).
--
-- Aditiva: só adiciona coluna/índice/linha de catálogo. Nada é apagado.
-- RLS: nenhuma tabela nova; as policies de clients/menu_optimizations seguem valendo.
-- ============================================================================

-- 1) Catálogo global de extensões
insert into public.extensions (slug, name, description, homepage_url)
values (
    'orvia-cardapioweb',
    'Orvia · Otimizador Cardápio Web',
    'Sincroniza o cardápio do Portal do Cardápio Web, analisa com o Orvia, aplica o que você aprovar e envia o relatório com prints.',
    null
)
on conflict (slug) do nothing;

-- 2) Trava de loja do Cardápio Web (independente da do iFood)
alter table public.clients add column if not exists cardapioweb_store_id text;
comment on column public.clients.cardapioweb_store_id is 'ID da loja no Cardápio Web (informado pela extensão). Impede importar cardápio de outra loja.';
create unique index if not exists uq_clients_cardapioweb_store
    on public.clients (workspace_id, cardapioweb_store_id) where cardapioweb_store_id is not null;

-- 3) Canal de cada otimização enviada
alter table public.menu_optimizations
    add column if not exists platform text not null default 'ifood';
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'menu_optimizations_platform_check') then
        alter table public.menu_optimizations
            add constraint menu_optimizations_platform_check check (platform in ('ifood', 'cardapioweb'));
    end if;
end $$;
comment on column public.menu_optimizations.platform is 'Canal de origem: ifood (extensão orvia-ifood) ou cardapioweb (extensão orvia-cardapioweb). Definido pela extensão da chave.';
create index if not exists idx_menu_optimizations_platform
    on public.menu_optimizations (workspace_id, platform, created_at desc);
