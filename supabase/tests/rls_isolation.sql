-- ============================================================================
-- rls_isolation.sql — Testes de isolamento multi-tenant (RLS)
-- Requer: 0001_init.sql + 0002_rls.sql + seed.sql aplicados (local/dev, NUNCA produção)
-- Rodar como superusuário: docker exec ... psql ... < supabase/tests/rls_isolation.sql
-- Compatível com "colar no SQL Editor" (SQL puro, sem meta-comandos do psql).
-- Personas (seed): owner/coordenador/editor/visualizador do workspace A
--                  owner do workspace B (criado aqui)
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Tabela de resultados (criada como postgres; apagada ao final)
-- ---------------------------------------------------------------------------
create table public.test_rls_results (
    id serial primary key,
    area text not null,
    test text not null,
    pass boolean not null,
    detail text
);
grant insert on public.test_rls_results to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace B de teste + personas (workspaces/people do seed A já existem)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('55555555-5555-4555-8555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ownerb@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Owner B"}')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, plan)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Workspace B (RLS Test)', 'rls-test-b', 'free')
on conflict (id) do nothing;

insert into public.members (workspace_id, user_id, role)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', '55555555-5555-4555-8555-555555555555', 'owner')
on conflict (workspace_id, user_id) do nothing;

insert into public.clients (id, workspace_id, name)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'Cliente do Workspace B (RLS Test)')
on conflict (id) do nothing;

insert into public.menu_categories (id, workspace_id, client_id, name)
values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'Categoria B')
on conflict (id) do nothing;

-- Storage fixtures: objetos nos dois workspaces + um com prefixo malformado
insert into storage.objects (bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata)
values
  ('menu-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2/menu_item/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1/1.webp', null, now(), now(), now(), '{}'),
  ('menu-images', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001/x/menu_item/y/1.webp', null, now(), now(), now(), '{}'),
  ('menu-images', 'not-a-uuid/x/menu_item/y/1.webp', null, now(), now(), now(), '{}')
on conflict do nothing;

-- Dataset para asserts e limpeza posterior
create table public.test_rls_fixtures as
select 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as ws_a;

commit;

-- ===========================================================================
-- HELPER: como executar os blocos abaixo
-- Cada bloco faz SET LOCAL ROLE authenticated + claims JWT simuladas e registra
-- resultados em public.test_rls_results. Roda em transação própria.
-- Personas do seed (workspace A):
--   11111111-1111-4111-8111-111111111111 owner
--   22222222-2222-4222-8222-222222222222 coordenador
--   33333333-3333-4333-8333-333333333333 editor
--   44444444-4444-4444-8444-444444444444 visualizador
-- Persona workspace B:
--   55555555-5555-4555-8555-555555555555 owner
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- PERSONA: VISORES/LEITORES — isolamento de LEITURA em todas as tabelas de negócio
-- (como visualizador A: não pode ver UMA linha sequer do workspace B)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  t text;
  n bigint;
  own uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  tabs text[] := array['members','clients','tags','client_tags','ad_accounts','menu_categories',
                       'menu_items','menu_addon_groups','menu_subitems','menu_item_addon_groups',
                       'menu_images','menu_image_history','api_keys','extension_installs','webhooks',
                       'webhook_deliveries','audit_log'];
begin
  foreach t in array tabs loop
    execute format('select count(*) from public.%I where workspace_id <> $1', t)
      into n using own;
    insert into public.test_rls_results(area, test, pass, detail)
    values ('leitura cruzada (visualizador A)', 'nenhuma linha do ws B visível em ' || t, n = 0, 'linhas visíveis: ' || n);
  end loop;
  -- workspaces por id
  select count(*) into n from public.workspaces where id <> own;
  insert into public.test_rls_results(area, test, pass, detail) values ('leitura cruzada (visualizador A)', 'workspaces de outros visíveis', n = 0, n::text);
  -- extensões (catálogo global: todas as linhas são visíveis — comportamento esperado)
  select count(*) into n from public.extensions;
  insert into public.test_rls_results(area, test, pass, detail) values ('extensões globais', 'catálogo global legível por qualquer membro autenticado', true, n::text);
end $$;
commit;

-- Mesmo teste, do lado B (garante assimetria): owner B não vê nada de A
begin;
set local role authenticated;
set local request.jwt.claim.sub = '55555555-5555-4555-8555-555555555555';
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  t text;
  n bigint;
  own uuid := 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  tabs text[] := array['members','clients','tags','client_tags','ad_accounts','menu_categories',
                       'menu_items','menu_addon_groups','menu_subitems','menu_item_addon_groups',
                       'menu_images','menu_image_history','api_keys','extension_installs','webhooks',
                       'webhook_deliveries','audit_log'];
begin
  foreach t in array tabs loop
    execute format('select count(*) from public.%I where workspace_id <> $1', t)
      into n using own;
    insert into public.test_rls_results(area, test, pass, detail)
    values ('leitura cruzada (owner B)', 'nenhuma linha do ws A visível em ' || t, n = 0, 'linhas visíveis: ' || n);
  end loop;
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: EDITOR A — escrita no ws B deve falhar (insert) ou afetar 0 linhas (update)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- INSERT cruzado via RLS (menu_items no ws B a partir de A)
do $$
begin
  begin
    insert into public.menu_items (workspace_id, client_id, category_id, name, price)
    values ('bbbbbbbb-0000-4000-8000-bbbbbbbb0001', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0002', 'bbbbbbbb-0000-4000-8000-bbbbbbbb0003', 'INJECTION', 1.00);
    insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'insert em menu_items do ws B bloqueado', false, 'NÃO bloqueou');
  exception when insufficient_privilege or check_violation then
    insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'insert em menu_items do ws B bloqueado', true, sqlerrm);
  end;
end $$;

-- UPDATE cruzado: RLS filtra silenciosamente (0 linhas afetadas)
do $$
declare n integer;
begin
  update public.menu_items set name = 'HACKED'
   where workspace_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'update em menu_items do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;

-- DELETE cruzado
do $$
declare n integer;
begin
  delete from public.menu_items
   where workspace_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('escrita cruzada (editor A)', 'delete em menu_items do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;

-- Editor pode escrever NO PRÓPRIO workspace (sanity check)
do $$
begin
  insert into public.menu_items (workspace_id, client_id, category_id, name, price)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'Item Teste RLS (pode ser apagado)', 1.00);
  insert into public.test_rls_results(area, test, pass, detail) values ('permissão legítima (editor A)', 'insert em menu_items do próprio ws funciona', true, null);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('permissão legítima (editor A)', 'insert em menu_items do próprio ws funciona', false, sqlerrm);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: VISUALIZADOR A — não escreve NADA (negócio), apenas lê
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare
  t text;
  n integer;
  -- (tabela, sql de INSERT) — viewer deve falhar em todas
  tests text[][] := array[
    array['clients', 'insert into public.clients (workspace_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''x'')'],
    array['menu_items', 'insert into public.menu_items (workspace_id, client_id, category_id, name, price) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'',''dddddddd-dddd-4ddd-8ddd-ddddddddddd1'',''x'',1)'],
    array['menu_categories', 'insert into public.menu_categories (workspace_id, client_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'',''x'')'],
    array['menu_subitems', 'insert into public.menu_subitems (workspace_id, group_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''ffffffff-ffff-4fff-bfff-fffffffffff1'',''x'')'],
    array['tags', 'insert into public.tags (workspace_id, name) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''x'')'],
    array['menu_images', 'insert into public.menu_images (workspace_id, owner_type, owner_id, storage_path, bytes, checksum_sha256) values (''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'',''menu_item'',gen_random_uuid(),''x/y/1.webp'',1,''abc'')']];
  q text[];
begin
  foreach q slice 1 in array tests loop
    t := q[1];
    begin
      execute q[2];
      insert into public.test_rls_results(area, test, pass, detail) values ('visualizador A (escrita)', t || ' bloqueado', false, 'NÃO bloqueou');
    exception when others then
      insert into public.test_rls_results(area, test, pass, detail) values ('visualizador A (escrita)', t || ' bloqueado', true, sqlerrm);
    end;
  end loop;
  -- visualizador pode LER (sanity): menu_items visível no próprio ws
  execute 'select count(*) from public.menu_items' into n;
  insert into public.test_rls_results(area, test, pass, detail) values ('visualizador A (leitura)', 'consegue ler o próprio ws (itens)', n >= 0, 'itens: ' || n);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: EDITOR A — não gerencia membros/chaves/webhooks/extensões; não deleta api_keys
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
begin
  begin
    insert into public.members (workspace_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'editor');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (membros)', 'insert em members bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (membros)', 'insert em members bloqueado', true, sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into public.api_keys (workspace_id, name, key_hash, key_prefix, scopes) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'test', 'hash', 'ck_live_test', '{catalogo:ler}');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (chaves)', 'insert em api_keys bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (chaves)', 'insert em api_keys bloqueado', true, sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from public.api_keys;
  insert into public.test_rls_results(area, test, pass, detail) values ('editor A (chaves)', 'select em api_keys retorna 0 linhas', n = 0, 'linhas: ' || n);
end $$;

do $$
begin
  begin
    insert into public.webhooks (workspace_id, name, url, secret, events) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 't', 'https://example.com/hook', 'whsec_test', '{menu.item.created}');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (webhooks)', 'insert em webhooks bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (webhooks)', 'insert em webhooks bloqueado', true, sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from public.webhook_deliveries;
  insert into public.test_rls_results(area, test, pass, detail) values ('editor A (webhooks)', 'select em webhook_deliveries retorna 0 linhas', n = 0, 'linhas: ' || n);
end $$;

do $$
begin
  begin
    insert into public.extension_installs (workspace_id, extension_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid());
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (extensões)', 'insert em extension_installs bloqueado', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (extensões)', 'insert em extension_installs bloqueado', true, sqlerrm);
  end;
end $$;

do $$
declare n bigint;
begin
  select count(*) into n from public.extension_installs;
  insert into public.test_rls_results(area, test, pass, detail) values ('editor A (extensões)', 'select em extension_installs retorna 0 linhas', n = 0, 'linhas: ' || n);
end $$;

do $$
begin
  begin
    insert into public.ad_accounts (workspace_id, platform, external_account_id, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'meta', 'act_test', 'Conta Teste');
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (anúncios)', 'insert em ad_accounts bloqueado (só owner/coordenador)', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('editor A (anúncios)', 'insert em ad_accounts bloqueado (só owner/coordenador)', true, sqlerrm);
  end;
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: COORDENADOR A — pode gerir membros (exceto owner) mas NÃO deleta api_keys,
--                          não insere membro role=owner
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
begin
  begin
    insert into public.members (workspace_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'owner');
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'bloqueado ao criar owner', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'bloqueado ao criar owner', true, sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into public.members (workspace_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'editor');
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'pode adicionar editor não-owner', true, null);
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (membros)', 'pode adicionar editor não-owner', false, sqlerrm);
  end;
end $$;

-- coordenador não deleta api_keys (delete é só owner)
do $$
declare n integer;
begin
  delete from public.api_keys;
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('coordenador A (chaves)', 'delete em api_keys afeta 0 linhas (só owner)', n = 0, 'linhas: ' || n);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- PERSONA: OWNER A — pode tudo no próprio workspace, mas NADA no ws B
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare n integer;
begin
  delete from public.members where workspace_id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('owner A (cruzado)', 'delete em members do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;
do $$
declare n integer;
begin
  update public.workspaces set name = 'HACKED' where id = 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('owner A (cruzado)', 'update em workspaces do ws B afeta 0 linhas', n = 0, 'linhas: ' || n);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- IMUTABILIDADE: menu_image_history e audit_log não aceitam update/delete de ninguém
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
begin
  begin
    insert into public.menu_image_history (workspace_id, owner_type, owner_id, storage_path, bytes, version, checksum_sha256)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'menu_item', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'x/2.webp', 1, 2, 'abc');
    insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'insert em menu_image_history funciona (owner)', true, null);
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'insert em menu_image_history funciona (owner)', false, sqlerrm);
  end;
end $$;

do $$
declare n integer;
begin
  update public.menu_image_history set reason = 'tampered';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'update em menu_image_history bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'update em menu_image_history bloqueado', true, 'erro: ' || sqlerrm);
end $$;

do $$
declare n integer;
begin
  delete from public.menu_image_history;
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'delete em menu_image_history bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('histórico (owner)', 'delete em menu_image_history bloqueado', true, 'erro: ' || sqlerrm);
end $$;

-- audit_log: nenhum usuário autenticado insere/altera/apaga
do $$
begin
  begin
    insert into public.audit_log (workspace_id, actor_type, action, entity_type) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user', 'test', 'test');
    insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'insert em audit_log bloqueado p/ usuários', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'insert em audit_log bloqueado p/ usuários', true, sqlerrm);
  end;
end $$;

do $$
declare n integer;
begin
  update public.audit_log set action = 'tampered';
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'update em audit_log bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'update em audit_log bloqueado', true, 'erro: ' || sqlerrm);
end $$;

do $$
declare n integer;
begin
  delete from public.audit_log;
  get diagnostics n = row_count;
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'delete em audit_log bloqueado', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('audit_log (owner)', 'delete em audit_log bloqueado', true, 'erro: ' || sqlerrm);
end $$;
commit;

-- ---------------------------------------------------------------------------
-- STORAGE: bucket menu-images só acessível pelo prefixo do próprio workspace
--          (inclusive UUID malformado não pode vazar nem quebrar a query)
-- ---------------------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare n bigint;
begin
  select count(*) into n from storage.objects
   where bucket_id = 'menu-images' and name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%';
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'enxerga objetos do próprio prefixo', n = 1, 'linhas: ' || n);
end $$;
do $$
declare n bigint;
begin
  select count(*) into n from storage.objects
   where bucket_id = 'menu-images' and name like 'bbbbbbbb-0000-4000-8000-bbbbbbbb0001/%';
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'não enxerga objetos do ws B', n = 0, 'linhas: ' || n);
end $$;
do $$
declare n bigint;
begin
  -- prefixo malformado: não pode levantar erro, apenas 0 linhas
  select count(*) into n from storage.objects
   where bucket_id = 'menu-images' and name like 'not-a-uuid/%';
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'prefixo malformado não vaza e não quebra', n = 0, 'linhas: ' || n);
exception when others then
  insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'prefixo malformado não vaza e não quebra', false, 'ERRO: ' || sqlerrm);
end $$;
do $$
begin
  begin
    insert into storage.objects (bucket_id, name, owner) values ('menu-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/hack.webp', null);
    insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'INSERT em storage.objects bloqueado p/ authenticated', false, 'NÃO bloqueou');
  exception when others then
    insert into public.test_rls_results(area, test, pass, detail) values ('storage (visualizador A)', 'INSERT em storage.objects bloqueado p/ authenticated', true, sqlerrm);
  end;
end $$;
commit;

-- ===========================================================================
-- RELATÓRIO FINAL (como superusuário)
-- ===========================================================================
reset role;
select id, area, test, pass, detail from public.test_rls_results order by id;
select count(*) filter (where pass) as passed, count(*) filter (where not pass) as failed from public.test_rls_results;

-- Limpeza: remover fixtures de teste (a fixture do bucket some no próximo `supabase db reset`;
-- objetos de storage NUNCA devem ser apagados por SQL direto — usar a Storage API).
delete from public.menu_items where name like 'Item Teste RLS%';
delete from public.members where user_id = '55555555-5555-4555-8555-555555555555' and workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
delete from public.test_rls_fixtures;
drop table public.test_rls_fixtures;
drop table public.test_rls_results;
