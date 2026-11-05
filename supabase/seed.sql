-- ============================================================================
-- seed.sql — Dados FICTÍCIOS para desenvolvimento local (nunca dados reais)
-- Aplicado por `supabase db reset`. Roda como superusuário (bypassa RLS de propósito).
-- ============================================================================

-- Usuários de demonstração (fictícios). Em Supabase local, auth.users é o caminho padrão.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dono@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Dono"}'),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coordenador@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Coordenador"}'),
  ('33333333-3333-4333-8333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'editor@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Editor"}'),
  ('44444444-4444-4444-8444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Demo Visualizador"}')
on conflict (id) do nothing;

insert into public.workspaces (id, name, slug, plan)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Orvia Demo', 'orvia-demo', 'pro')
on conflict (id) do nothing;

insert into public.members (workspace_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'coordenador'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'editor'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'visualizador')
on conflict (workspace_id, user_id) do nothing;

-- Clientes fictícios
insert into public.clients (id, workspace_id, name, legal_name, document, contact_name, email, phone, whatsapp, instagram, status, delivery_status, monthly_fee, notes)
values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pizzaria do Ze (Demo)', 'Ze Pizzas Ltda (Demo)', '00.000.000/0001-00', 'José Demo', 'ze.demo@example.com', '+55 11 90000-0001', '+55 11 90000-0001', '@pizzariadozedemo', 'ativo', 'no_prazo', 1500.00, 'Cliente fictício para desenvolvimento'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Hamburgueria Astro (Demo)', 'Astro Foods Ltda (Demo)', '00.000.000/0001-01', 'Ana Demo', 'ana.demo@example.com', '+55 11 90000-0002', '+55 11 90000-0002', '@astrohamburguerdemo', 'ativo', 'atrasado', 2200.00, 'Cliente fictício para desenvolvimento')
on conflict (id) do nothing;

insert into public.tags (id, workspace_id, name, color)
values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tráfego pago', '#2F6BFF'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'delivery', '#22D3EE')
on conflict (id) do nothing;

insert into public.client_tags (workspace_id, client_id, tag_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2')
on conflict do nothing;

-- Cardápio fictício
insert into public.menu_categories (id, workspace_id, client_id, name, sort_order, status)
values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Lanches', 10, 'active'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Bebidas', 20, 'active')
on conflict (id) do nothing;

insert into public.menu_items (id, workspace_id, client_id, category_id, sku, name, description, price, status, sort_order)
values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'LAN-001', 'X-Burger Clássico (Demo)', 'Hambúrguer artesanal 150g com queijo e molho da casa', 32.90, 'active', 10),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'LAN-002', 'Astro Bacon (Demo)', 'Burger duplo com bacon crocante', 41.50, 'out_of_stock', 20),
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'BEB-001', 'Refrigerante Lata (Demo)', 'Lata 350ml gelada', 6.00, 'active', 10)
on conflict (id) do nothing;

insert into public.menu_addon_groups (id, workspace_id, client_id, name, min_qty, max_qty, sort_order, status)
values
  ('ffffffff-ffff-4fff-bfff-fffffffffff1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'Adicionais', 0, 3, 10, 'active')
on conflict (id) do nothing;

insert into public.menu_subitems (id, workspace_id, group_id, name, price_delta, sort_order, status)
values
  ('99999999-9999-4999-8999-999999999991', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 'Bacon extra (Demo)', 4.00, 10, 'active'),
  ('99999999-9999-4999-8999-999999999992', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 'Queijo extra (Demo)', 3.00, 20, 'active')
on conflict (id) do nothing;

insert into public.menu_item_addon_groups (workspace_id, item_id, group_id, sort_order)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 10),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'ffffffff-ffff-4fff-bfff-fffffffffff1', 10)
on conflict do nothing;
