-- Testes da 0006 (canal Cardápio Web). LOCAL apenas — nunca produção.
--   docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/cardapioweb_channel.sql
-- Esperado: todas as linhas com ok = true. Roda dentro de transação e desfaz tudo.
begin;
create temp table r (teste text, ok boolean, detalhe text);

insert into r select 'extensão orvia-cardapioweb no catálogo', count(*) = 1, count(*)::text from public.extensions where slug = 'orvia-cardapioweb';
insert into r select 'coluna clients.cardapioweb_store_id', count(*) = 1, count(*)::text
  from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'cardapioweb_store_id';
insert into r select 'coluna menu_optimizations.platform default ifood', bool_and(column_default like '''ifood''%'), max(column_default)
  from information_schema.columns where table_schema = 'public' and table_name = 'menu_optimizations' and column_name = 'platform';
insert into r select 'RLS segue ligada em clients e menu_optimizations', bool_and(rowsecurity), string_agg(tablename || '=' || rowsecurity, ',')
  from pg_tables where schemaname = 'public' and tablename in ('clients', 'menu_optimizations');

-- Trava por canal: mesma loja do Cardápio Web não pode ir para 2 clientes; iFood e Cardápio Web convivem no mesmo cliente
do $$
declare ws uuid; c1 uuid; c2 uuid; dup boolean := false; bad boolean := false;
begin
  select id into ws from public.workspaces order by created_at limit 1;
  if ws is null then insert into r values ('trava por canal', false, 'sem workspace no seed'); return; end if;
  insert into public.clients (workspace_id, name, ifood_merchant_id, cardapioweb_store_id) values (ws, 'Teste 0006 A', 'ifood-0006', 'cw-0006') returning id into c1;
  begin
    insert into public.clients (workspace_id, name, cardapioweb_store_id) values (ws, 'Teste 0006 B', 'cw-0006') returning id into c2;
  exception when unique_violation then dup := true;
  end;
  insert into r values ('mesma loja Cardápio Web em 2 clientes → bloqueado', dup, null);
  insert into r values ('cliente com loja iFood E Cardápio Web', exists (select 1 from public.clients where id = c1 and ifood_merchant_id = 'ifood-0006' and cardapioweb_store_id = 'cw-0006'), null);
  begin
    insert into public.menu_optimizations (workspace_id, client_id, plan_hash, platform) values (ws, c1, 'abc0006', 'outro');
  exception when check_violation then bad := true;
  end;
  insert into r values ('platform fora de ifood/cardapioweb → bloqueado', bad, null);
end $$;

select teste, ok, detalhe from r order by ok, teste;
select count(*) filter (where ok) as passou, count(*) filter (where not ok) as falhou from r;
rollback;
