-- ============================================================================
-- combos_ifood.sql — Testes da 0004 (combos + fila de sincronização iFood)
-- LOCAL apenas (depois de `npx supabase db reset`). Tudo em transação com ROLLBACK.
--   docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/combos_ifood.sql
-- Esperado: N passed / 0 failed
-- ============================================================================
begin;

create temp table r (test text, pass boolean, detail text);
grant insert, select on r to authenticated;

-- Fixtures: um segundo cliente no workspace A e um item dele
insert into public.clients (id, workspace_id, name)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Outro cliente (Teste)');
insert into public.menu_categories (id, workspace_id, client_id, name)
values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd9', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', 'Cat outro');
insert into public.menu_items (id, workspace_id, client_id, category_id, name, price)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9', 'Item de outro cliente', 10);

-- 1) Seed: combo com 2 componentes
insert into r select 'seed: combo tem 2 componentes', count(*) = 2, count(*)::text
  from public.menu_combo_components where combo_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';

-- 2) Componente de outro cliente é rejeitado
do $$ begin
  insert into public.menu_combo_components (workspace_id, combo_id, component_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9');
  insert into r values ('componente de outro cliente bloqueado', false, 'inseriu');
exception when others then
  insert into r values ('componente de outro cliente bloqueado', true, sqlerrm);
end $$;

-- 3) Combo dentro de combo é rejeitado
do $$ begin
  insert into public.menu_items (id, workspace_id, client_id, category_id, name, price, kind)
  values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'Combo 2', 50, 'combo');
  insert into public.menu_combo_components (workspace_id, combo_id, component_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee10', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4');
  insert into r values ('combo como componente bloqueado', false, 'inseriu');
exception when others then
  insert into r values ('combo como componente bloqueado', true, sqlerrm);
end $$;

-- 4) Componente apontando para "combo" que é item simples é rejeitado
do $$ begin
  insert into public.menu_combo_components (workspace_id, combo_id, component_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3');
  insert into r values ('item simples como combo bloqueado', false, 'inseriu');
exception when others then
  insert into r values ('item simples como combo bloqueado', true, sqlerrm);
end $$;

-- 5) Mudar tipo de item que participa de combo é bloqueado
do $$ begin
  update public.menu_items set kind = 'combo' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  insert into r values ('mudar kind de componente bloqueado', false, 'atualizou');
exception when others then
  insert into r values ('mudar kind de componente bloqueado', true, sqlerrm);
end $$;

-- 6) Fila iFood: sincronizar zera pendência; editar volta a pendente
select * from public.mark_menu_items_ifood_synced('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1']::uuid[], null, 'IFOOD-X1');
insert into r select 'sincronizado sai da fila', not (ifood_synced_at is null or updated_at > ifood_synced_at), updated_at::text || ' / ' || ifood_synced_at::text
  from public.menu_items where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';

-- (nova transação lógica: savepoint não muda now(); simulamos edição posterior forçando synced_at no passado)
update public.menu_items set ifood_synced_at = now() - interval '1 minute' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
update public.menu_items set ifood_synced_at = ifood_synced_at where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
insert into r select 'editado depois de sincronizar volta à fila', (updated_at > ifood_synced_at), updated_at::text || ' / ' || ifood_synced_at::text
  from public.menu_items where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';

-- 7) ifood_id único por cliente
do $$ begin
  update public.menu_items set ifood_id = 'IFOOD-X1' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  insert into r values ('ifood_id duplicado no cliente bloqueado', false, 'atualizou');
exception when unique_violation then
  insert into r values ('ifood_id duplicado no cliente bloqueado', true, sqlerrm);
end $$;

-- 8) Mesmo ifood_id em OUTRO cliente é permitido
update public.menu_items set ifood_id = 'IFOOD-X1' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9';
insert into r values ('ifood_id igual em outro cliente permitido', true, null);

-- 9) RLS: visualizador lê, mas não escreve componentes
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
insert into r select 'visualizador lê componentes', count(*) >= 2, count(*)::text from public.menu_combo_components;
do $$ begin
  insert into public.menu_combo_components (workspace_id, combo_id, component_id)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2');
  insert into r values ('visualizador não escreve componentes', false, 'inseriu');
exception when others then
  insert into r values ('visualizador não escreve componentes', true, sqlerrm);
end $$;

-- 10) RLS: editor escreve componentes (e o combo volta a ficar pendente)
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
insert into public.menu_combo_components (workspace_id, combo_id, component_id, quantity)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 2);
insert into r select 'editor escreve componentes', count(*) = 3, count(*)::text
  from public.menu_combo_components where combo_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';

-- 11) Usuário sem vínculo não vê componentes
set local request.jwt.claims = '{"sub":"99999999-0000-4000-8000-000000000000","role":"authenticated"}';
insert into r select 'estranho não vê componentes', count(*) = 0, count(*)::text from public.menu_combo_components;

reset role;

-- 11b) RPC com If-Match divergente não altera nada
insert into r select 'rpc com If-Match divergente não atualiza', count(*) = 0, count(*)::text
  from public.mark_menu_items_ifood_synced('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3']::uuid[], '2000-01-01T00:00:00Z', null);

-- 11c) RPC respeita RLS: visualizador não marca
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
insert into r select 'visualizador não marca sincronizado (RLS)', count(*) = 0, count(*)::text
  from public.mark_menu_items_ifood_synced('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3']::uuid[], null, null);
reset role;

-- 12) Extensão registrada no catálogo
insert into r select 'extensão orvia-ifood no catálogo', count(*) = 1, count(*)::text from public.extensions where slug = 'orvia-ifood';

select test, pass, left(coalesce(detail, ''), 90) as detail from r;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from r;

rollback;
