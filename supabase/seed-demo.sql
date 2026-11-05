-- ============================================================================
-- seed-demo.sql — Dados FICTÍCIOS de demonstração (prefixo "(Demo)")
-- NÃO rodar em produção do cliente real; apenas em desenvolvimento/preview.
-- Reset local:  docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/seed-demo.sql
-- ============================================================================

-- Workspace demo
insert into public.workspaces (id, name, slug, plan)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Orvia Demo', 'orvia-demo', 'pro')
on conflict (id) do nothing;

-- Usuários demo já existentes no seed.sql (owner/coordenador/editor/visualizador).

-- Tags
insert into public.tags (id, workspace_id, name, color) values
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Prioridade (Demo)', '#F87171'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Delivery (Demo)', '#22D3EE'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Tráfego pago (Demo)', '#2F6BFF'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'VIP (Demo)', '#FBBF24')
on conflict (id) do nothing;

-- Clientes (todos fictícios)
insert into public.clients (id, workspace_id, name, segment, situation, campaign_state, creative_status, delivery_state, editor, termination_date, last_change_at, has_alert, pix_paid_at, pix_amount, routine_week, routine_report, routine_upload, routine_ia, routine_share, routine_note, routine_camera, monthly_fee, status) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbddd1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'D''Vivi (Demo)', 'Pizzaria', 'ativo', 'ativo', 'nao_definido', 'estatico_pronto', 'Bruna', '2026-12-03', now() - interval '1 day', false, now() - interval '3 days', 800.00, '2026-W45', true, true, true, false, false, true, 1500.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbddd2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'World Burguer (Demo)', 'Hamburgueria', 'ativo', 'ativo', 'em_producao', 'estatico_pronto', 'Bruna', '2026-12-01', now() - interval '1 day', false, null, null, '2026-W45', true, false, false, false, false, false, 2200.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Obentô (Demo)', 'Japonês', 'ativo', 'ativo', 'nao_definido', 'estatico_pronto', 'Bruna', '2026-12-01', now() - interval '6 days', true, null, null, '2026-W45', true, false, false, false, false, false, 1800.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pizzaria Casarão (Demo)', 'Pizzaria', 'ativo', 'ativo', 'nao_definido', 'estatico_pronto', 'Bruna', '2026-11-06', now() - interval '20 days', true, null, null, '2026-W44', true, false, false, false, false, false, 1200.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Imperium Burguer (Demo)', 'Hamburgueria', 'ativo', 'ativo', 'nao_definido', 'estatico_pronto', 'Bruna', '2026-11-08', now() - interval '1 day', false, null, null, '2026-W45', true, true, false, false, false, true, 2500.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gran Vista (Demo)', 'Restaurante', 'stand_by', 'pausado', 'nao_definido', 'sem_criativo', 'Bruna', '2026-12-27', now() - interval '1 day', false, null, null, '2026-W44', false, false, false, false, false, false, 2000.00, 'pausado'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Gullá Burger (Demo)', 'Hamburgueria', 'ativo', 'ativo', 'nao_definido', 'pendente', 'Brenda', '2026-11-09', now() - interval '9 days', true, null, null, '2026-W45', true, false, false, false, false, false, 1900.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Costelaria Cuiabana (Demo)', 'Costelaria', 'ativo', 'ativo', 'em_aprovacao', 'estatico_pronto', 'Brenda', '2026-12-27', now() - interval '2 days', false, now() - interval '2 days', 2500.00, '2026-W45', true, true, true, false, false, true, 3100.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pizzaria Caprioli (Demo)', 'Pizzaria', 'ativo', 'ativo', 'nao_definido', 'estatico_pronto', 'Bruna', '2026-11-08', now() - interval '5 days', false, null, null, '2026-W45', true, true, false, false, false, true, 1600.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb10', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Pop Coffee Goiânia (Demo)', 'Cafeteria', 'ativo', 'ativo', 'nao_definido', 'pendente', 'Brenda', '2026-11-07', now() - interval '5 days', false, null, null, '2026-W45', true, false, false, false, false, true, 1400.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Restaurante Essência (Demo)', 'Restaurante', 'ativo', 'ativo', 'nao_definido', 'sem_criativo', 'Brenda', '2026-11-07', now() - interval '3 days', false, null, null, '2026-W44', false, false, false, false, false, false, 2750.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb12', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Padaria do Bairro (Demo)', 'Padaria', 'onboarding', 'planejamento', 'em_producao', 'pendente', '', '2026-12-15', now() - interval '1 day', false, null, null, '', false, false, false, false, false, false, 1000.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb13', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'A Favorita (Demo)', 'Lanches', 'ativo', 'ativo', 'estatico_pronto', 'video_pronto', 'Bruna', '2026-12-19', now() - interval '2 days', false, now() - interval '1 day', 900.00, '2026-W45', true, true, true, true, true, true, 2100.00, 'ativo'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb14', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Confeitaria Aurora (Demo)', 'Confeitaria', 'churn', 'encerrado', 'nao_definido', 'sem_criativo', 'Brenda', '2026-10-30', now() - interval '45 days', false, null, null, '', false, false, false, false, false, false, 800.00, 'encerrado')
on conflict (id) do nothing;

-- Tags nos clientes
insert into public.client_tags (workspace_id, client_id, tag_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbddd1', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbddd2', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb13', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4')
on conflict do nothing;

-- Contas de anúncio (algumas "acompanhadas", saldos variados)
insert into public.ad_accounts (id, workspace_id, client_id, platform, external_account_id, name, balance, spend_month, currency, status, is_watched, last_synced_at) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbddd1', 'meta', 'act_1436606213455164', 'D''Vivi (Demo)', 314.43, 58.68, 'BRL', 'active', true, now() - interval '4 minutes'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbddd2', 'meta', 'act_1663435400463031', 'World Burguer (Demo)', 0.00, 86.06, 'BRL', 'active', true, now() - interval '4 minutes'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', 'meta', 'act_369219015499063', 'Obentô (Demo)', 7.98, 58.68, 'BRL', 'active', true, now() - interval '4 minutes'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', 'meta', 'act_9407000407503185', 'Pizzaria Casarão (Demo)', -264.85, 9.68, 'BRL', 'active', true, now() - interval '4 minutes'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd5', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5', 'meta', 'act_1493107845179737', 'Imperium Burguer (Demo)', -310.34, 0.00, 'BRL', 'active', true, now() - interval '4 minutes'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8', 'meta', 'act_1075068927695987', 'BM - Gullá Burger (Demo)', 83.00, 810.50, 'BRL', 'active', true, now() - interval '4 minutes'),
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd7', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb9', 'meta', 'act_4123456789012345', 'Pizzaria Caprioli (Demo)', 203.03, 105.91, 'BRL', 'active', true, now() - interval '4 minutes')
on conflict (id) do nothing;
