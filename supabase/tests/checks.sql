-- ============================================================================
-- checks.sql — Checagens automáticas de higiene do schema (rodar como superusuário)
-- Cada bloco imprime linhas; ausência de linhas = problema corrigido.
-- ============================================================================

\echo '== 1. Tabelas do schema public SEM RLS habilitado (deve retornar 0 linhas) =='
select tablename as tabela_sem_rls
from pg_tables t
where t.schemaname = 'public'
  and not exists (select 1 from pg_class c where c.relname = t.tablename and c.relrowsecurity)
order by 1;

\echo '== 2. Tabelas do schema public SEM nenhuma policy (deve retornar 0 linhas) =='
select t.tablename as tabela_sem_policy
from pg_tables t
join pg_class c on c.relname = t.tablename
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
where not exists (select 1 from pg_policy p where p.polrelid = c.oid)
order by 1;

\echo '== 3. Funções security definer SEM "set search_path" (deve retornar 0 linhas) =='
select p.proname as funcao_definer_insegura
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (p.proconfig is null or not ('search_path=public' = any(p.proconfig) or exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path%')))
order by 1;

\echo '== 4. Chaves estrangeiras SEM índice na(s) coluna(s) referenciante(s) =='
select con.conname as fk, con.conrelid::regclass as tabela
from pg_constraint con
where con.contype = 'f'
  and not exists (
    select 1
    from pg_index idx
    where idx.indrelid = con.conrelid
      and con.conkey[1] = any(idx.indkey)
  )
order by 1;

\echo '== 5. Resumo de contagens =='
select
  (select count(*) from pg_tables where schemaname='public') as tabelas_public,
  (select count(*) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public') as policies_public,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef) as funcs_security_definer;
