-- ============================================================================
-- rls_cross_link.sql — Consistência de tenant: ligação A apontando para B deve FALHAR
-- Requer: 0001 + 0002 + 0003 + seed.sql. Rodar como SUPERUSUÁRIO (prova a camada FK/trigger;
-- a camada RLS já é coberta por rls_isolation.sql — 70 asserts).
-- docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/rls_cross_link.sql
-- ============================================================================

begin;
create table public.test_cross_link_results (
    id serial primary key,
    area text not null,
    test text not null,
    pass boolean not null,
    detail text
);
grant insert on public.test_cross_link_results to authenticated;

-- ---------------------------------------------------------------------------
-- Fixtures: workspace B com um registro de cada tipo (ids fixos)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerb@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner B"}')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, plan)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Workspace B (Cross-Link Test)', 'rls-test-b', 'free')
on conflict (id) do nothing;

insert into public.members (workspace_id, user_id, role)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', '55555555-5555-4555-8555-555555555555', 'owner')
on conflict (workspace_id, user_id) do nothing;

insert into public.clients (id, workspace_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Cliente B (XL)')
on conflict (id) do nothing;

insert into public.tags (id, workspace_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb00a1', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'tag-b (XL)'),
  ('cccccccc-0000-4000-8000-cccccccc00a1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tag-a (XL)')
on conflict (id) do nothing;

insert into public.menu_categories (id, workspace_id, client_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'Categoria B (XL)')
on conflict (id) do nothing;

insert into public.menu_items (id, workspace_id, client_id, category_id, name, price) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'Item B (XL)', 10.00)
on conflict (id) do nothing;

insert into public.menu_addon_groups (id, workspace_id, client_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0005', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'Grupo B (XL)')
on conflict (id) do nothing;

insert into public.menu_subitems (id, workspace_id, group_id, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0006', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0005', 'Subitem B (XL)')
on conflict (id) do nothing;

insert into public.api_keys (id, workspace_id, name, key_hash, key_prefix, scopes) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0007', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'key B (XL)', 'hashb', 'ck_live_xl_b', '{catalogo:ler}'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0008', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'key A (XL)', 'hasha', 'ck_live_xl_a', '{catalogo:ler}')
on conflict (id) do nothing;

insert into public.webhooks (id, workspace_id, name, url, secret, events) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Hook B (XL)', 'https://example.com/b', 'whsec_b', '{menu.item.created}'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0010', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hook A (XL)', 'https://example.com/a', 'whsec_a', '{menu.item.created}')
on conflict (id) do nothing;

-- Imagens (uma em cada workspace) para testar a trigger e a FK composta da história
insert into public.menu_images (id, workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, is_current, checksum_sha256)
values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0011', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'menu_item', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'xl/b/1.webp', 'image/webp', 10, 1, true, 'hashb'),
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0012', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'xl/a/1.webp', 'image/webp', 10, 1, true, 'hasha')
on conflict (id) do nothing;

insert into public.extensions (id, slug, name) values
  ('bbbbbbbb-0000-4000-8000-bbbbbbbb0013', 'xl-test-extension', 'XL Test Extension')
on conflict (id) do nothing;

commit;

-- ---------------------------------------------------------------------------
-- CASOS — todos executados como SUPERUSUÁRIO (camada de FK/trigger)
-- Cada caso: (1) ligação cruzada A→B deve FALHAR; (2) ligação legítima A→A deve funcionar; (3) limpeza.
-- ---------------------------------------------------------------------------

-- 1) client_tags: (A, cliente B) falha; (A, tag B) falha; (A, cliente A, tag A-XL) funciona
do $$
begin
  begin
    insert into public.client_tags (workspace_id, client_id, tag_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'cccccccc-0000-4000-8000-cccccccc00a1');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.client_tags (workspace_id, client_id, tag_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'bbbbbbbb-0000-4000-8000-bbbbbbbb00a1');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'tag cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'tag cruzada A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.client_tags (workspace_id, client_id, tag_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-0000-4000-8000-cccccccc00a1');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'ligação legítima A→A funciona', true, null);
  delete from public.client_tags where tag_id = 'cccccccc-0000-4000-8000-cccccccc00a1';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('client_tags', 'ligação legítima A→A funciona', false, sqlerrm);
end $$;

-- 2) ad_accounts: cliente cruzado falha
do $$
begin
  begin
    insert into public.ad_accounts (workspace_id, client_id, platform, external_account_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'meta', 'act_xl', 'XL');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('ad_accounts', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('ad_accounts', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 3) menu_categories: cliente cruzado falha
do $$
begin
  begin
    insert into public.menu_categories (workspace_id, client_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'XL Cat');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_categories', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_categories', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 4) menu_items: cliente cruzado falha / categoria cruzada falha
do $$
begin
  begin
    insert into public.menu_items (workspace_id, client_id, category_id, name, price)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'XL', 1.00);
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.menu_items (workspace_id, client_id, category_id, name, price)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'XL', 1.00);
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'categoria cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_items', 'categoria cruzada A→B falha', true, sqlerrm);
  end;
end $$;

-- 5) menu_addon_groups: cliente cruzado falha
do $$
begin
  begin
    insert into public.menu_addon_groups (workspace_id, client_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'XL Group');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_addon_groups', 'cliente cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_addon_groups', 'cliente cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 6) menu_subitems: grupo cruzado falha; legítimo funciona
do $$
begin
  begin
    insert into public.menu_subitems (workspace_id, group_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0005', 'XL');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'grupo cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'grupo cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.menu_subitems (workspace_id, group_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 'XL Sub (temp)');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'ligação legítima A→A funciona', true, null);
  delete from public.menu_subitems where name = 'XL Sub (temp)';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_subitems', 'ligação legítima A→A funciona', false, sqlerrm);
end $$;

-- 7) menu_item_addon_groups: item cruzado falha; grupo cruzado falha
do $$
begin
  begin
    insert into public.menu_item_addon_groups (workspace_id, item_id, group_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'ffffffff-ffff-4fff-bfff-fffffffffff1');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'item cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'item cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.menu_item_addon_groups (workspace_id, item_id, group_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0005')
    on conflict do nothing;
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'grupo cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_item_addon_groups', 'grupo cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 8) menu_image_history: imagem cruzada falha (FK composta); legítima funciona
do $$
begin
  begin
    insert into public.menu_image_history (workspace_id, owner_type, owner_id, storage_path, bytes, version, checksum_sha256, menu_image_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'xl/x.webp', 1, 9, 'abc', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0011');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history', 'menu_image cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history', 'menu_image cruzada A→B falha', true, sqlerrm);
  end;
end $$;

-- 9) extension_installs: api_key cruzada falha; legítima funciona
do $$
begin
  begin
    insert into public.extension_installs (workspace_id, extension_id, api_key_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0013', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0007');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'api_key cruzada A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'api_key cruzada A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.extension_installs (workspace_id, extension_id, api_key_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0013', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'ligação legítima A→A funciona', true, null);
  delete from public.extension_installs where api_key_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('extension_installs', 'ligação legítima A→A funciona', false, sqlerrm);
end $$;

-- 10) webhook_deliveries: webhook cruzado falha
do $$
begin
  begin
    insert into public.webhook_deliveries (workspace_id, webhook_id, event, payload) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'menu.item.created', '{}');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('webhook_deliveries', 'webhook cruzado A→B falha', false, 'NÃO falhou');
  exception when foreign_key_violation then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('webhook_deliveries', 'webhook cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- 11) menu_images (trigger): dono cruzado falha / legítimo funciona
do $$
begin
  begin
    insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0004', 'xl/cross.webp', 'image/webp', 1, 1, 'abc');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_item cruzado A→B falha', false, 'NÃO falhou');
  exception when others then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_item cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  begin
    insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_subitem', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0006', 'xl/cross2.webp', 'image/webp', 1, 1, 'abc');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_subitem cruzado A→B falha', false, 'NÃO falhou');
  exception when others then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'menu_subitem cruzado A→B falha', true, sqlerrm);
  end;
end $$;
do $$
begin
  insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, mime_type, bytes, version, checksum_sha256)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'xl/own.webp', 'image/webp', 1, 1, 'abc');
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'dono legítimo A→A funciona', true, null);
  delete from public.menu_images where storage_path = 'xl/own.webp';
exception when others then
  insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_images (trigger)', 'dono legítimo A→A funciona', false, sqlerrm);
end $$;

-- 12) menu_image_history (trigger): owner cruzado falha / legítimo funciona
do $$
begin
  begin
    insert into public.menu_image_history (workspace_id, owner_type, owner_id, storage_path, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_subitem', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0006', 'xl/histcross.webp', 1, 1, 'abc');
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history (trigger)', 'owner cruzado A→B falha', false, 'NÃO falhou');
  exception when others then
    insert into public.test_cross_link_results(area, test, pass, detail) values ('menu_image_history (trigger)', 'owner cruzado A→B falha', true, sqlerrm);
  end;
end $$;

-- ---------------------------------------------------------------------------
-- RELATÓRIO
-- ---------------------------------------------------------------------------
select id, area, test, pass, detail from public.test_cross_link_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from public.test_cross_link_results;

-- Limpeza das fixtures XL (os registros A/B permanecem; o reset seguinte os remove)
delete from public.webhook_deliveries where webhook_id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0010');
delete from public.extension_installs where api_key_id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0007', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008');
delete from public.menu_image_history where storage_path like 'xl/%';
delete from public.menu_images where storage_path like 'xl/%';
delete from public.api_keys where id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0007', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0008');
delete from public.webhooks where id in ('bbbbbbbb-0000-4000-8000-bbbbbbbb0009', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0010');
delete from public.extensions where slug = 'xl-test-extension';
drop table public.test_cross_link_results;
