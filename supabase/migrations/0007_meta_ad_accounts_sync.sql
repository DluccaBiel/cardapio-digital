-- ============================================================================
-- 0007_meta_ad_accounts_sync.sql — Campos da sincronização real com a Meta
-- Pré-requisito: 0001..0006 (não editados). BACKUP antes de aplicar em produção.
--
-- A sincronização (Graph API, token só no servidor: META_ACCESS_TOKEN) lê as
-- contas do portfólio empresarial (META_BUSINESS_ID): próprias + de clientes.
-- Aditiva: só adiciona colunas. RLS de ad_accounts (0002) segue valendo:
-- leitura = membro; escrita = owner/coordenador.
-- ============================================================================

alter table public.ad_accounts add column if not exists account_type        text not null default 'unknown';
alter table public.ad_accounts add column if not exists timezone            text;
alter table public.ad_accounts add column if not exists spend_total         numeric(14,2) not null default 0;
alter table public.ad_accounts add column if not exists owner_business_id   text;   -- BM dona da conta (o cliente, em contas compartilhadas)
alter table public.ad_accounts add column if not exists owner_business_name text;
alter table public.ad_accounts add column if not exists access_kind         text not null default 'owned';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'ad_accounts_account_type_check') then
        alter table public.ad_accounts add constraint ad_accounts_account_type_check check (account_type in ('prepaid', 'postpaid', 'unknown'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'ad_accounts_access_kind_check') then
        alter table public.ad_accounts add constraint ad_accounts_access_kind_check check (access_kind in ('owned', 'client'));
    end if;
end $$;

comment on column public.ad_accounts.account_type is 'prepaid (pré-paga) | postpaid (cartão/boleto) | unknown. Vem de is_prepay_account.';
comment on column public.ad_accounts.access_kind is 'owned = conta do próprio portfólio; client = conta de cliente compartilhada com o portfólio.';
comment on column public.ad_accounts.balance is 'Pré-paga: saldo disponível (positivo). Pós-paga: valor devido em negativo. Moeda da conta.';
