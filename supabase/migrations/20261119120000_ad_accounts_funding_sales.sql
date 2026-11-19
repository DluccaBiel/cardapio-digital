-- ============================================================================
-- 20261119120000_ad_accounts_funding_sales.sql — Saldo correto (Pix x cartão) e
-- resultados só de campanhas de VENDAS (pixel) para a Visão geral.
-- Pré-requisitos: até 20261118120000. BACKUP antes de aplicar em produção.
--
--   funding_kind          'pix' (pré-paga: saldo disponível) · 'card' (pós-paga no cartão:
--                         a Meta cobra o cartão; não há "saldo") · 'other' · 'unknown'
--   account_status_code   account_status cru da Meta (3 = pagamento pendente → devedor; 9 = carência)
--   unbilled_amount       pós-paga: valor já gasto e ainda não cobrado no cartão (NÃO é dívida)
--   spend_cap             limite de gastos da conta (0 = sem limite)
--   sales_*_month         só campanhas de vendas (OUTCOME_SALES/CONVERSIONS/catálogo) com
--                         compras do pixel — base do ROAS médio e do custo por resultado
--
-- Aditiva: só colunas novas (RLS da tabela já vale).
-- ============================================================================

alter table public.ad_accounts add column if not exists funding_kind          text not null default 'unknown';
alter table public.ad_accounts add column if not exists account_status_code   integer;
alter table public.ad_accounts add column if not exists unbilled_amount       numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists spend_cap             numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists sales_spend_month     numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists sales_revenue_month   numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists sales_purchases_month integer       not null default 0;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'ad_accounts_funding_kind_check') then
        alter table public.ad_accounts
            add constraint ad_accounts_funding_kind_check check (funding_kind in ('pix', 'card', 'other', 'unknown'));
    end if;
end $$;

comment on column public.ad_accounts.funding_kind is 'Forma de abastecimento: pix (pré-paga, saldo disponível) · card (pós-paga no cartão) · other · unknown.';
comment on column public.ad_accounts.unbilled_amount is 'Pós-paga: gasto ainda não cobrado no cartão (não é dívida). Dívida só com account_status_code 3/9.';
comment on column public.ad_accounts.sales_revenue_month is 'Faturamento do mês (compras do pixel) só de campanhas de vendas.';
