-- ============================================================================
-- reports_rls.sql — RLS/grants/constraints dos Relatórios nos grupos do WhatsApp
-- Requer: todas as migrations + seed.sql (workspace demo A com owner/coordenador/editor/visualizador).
-- Rodar LOCAL como superusuário; tudo em transação com ROLLBACK (não deixa resíduo).
--   docker exec -i supabase_db_<PASTA> psql -U postgres < supabase/tests/reports_rls.sql
-- Esperado: todas as linhas pass = t e o resumo "falhas = 0".
-- ============================================================================

begin;

create temp table r (id serial, test text, pass boolean, detail text);

create function pg_temp.chk(t text, uid uuid, q text, expect text) returns void language plpgsql as $$
declare n bigint; ok boolean; msg text;
begin
  if uid is null then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    execute 'set local role anon';
  else
    perform set_config('request.jwt.claim.sub', uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  begin
    if expect like 'rows:%' then
      execute 'select count(*) from (' || q || ') x' into n;
      ok := n = substr(expect, 6)::bigint;
      msg := 'linhas=' || n;
    else
      execute q;
      get diagnostics n = row_count;
      ok := case expect when 'ok' then n > 0 else n = 0 end;
      msg := 'afetadas=' || n;
    end if;
  exception when others then
    ok := expect = 'deny';
    msg := sqlerrm;
  end;
  execute 'reset role';
  insert into r (test, pass, detail) values (t, ok, msg);
end $$;

-- Fixtures --------------------------------------------------------------------
-- A = aaaaaaaa… (owner 1111, coordenador 2222, editor 3333, visualizador 4444); B = workspace novo
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('dddddddd-0000-4000-8000-dddddddd0012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-reports-b@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug, plan) values ('dddddddd-0000-4000-8000-dddddddd0011', 'Workspace B (Relatórios)', 'reports-test-b', 'free') on conflict (id) do nothing;
insert into public.members (workspace_id, user_id, role) values ('dddddddd-0000-4000-8000-dddddddd0011', 'dddddddd-0000-4000-8000-dddddddd0012', 'owner') on conflict do nothing;

insert into public.ad_accounts (id, workspace_id, external_account_id, name) values
  ('fafafafa-0000-4000-8000-fafafafa0001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'act_9001', 'Conta A'),
  ('fafafafa-0000-4000-8000-fafafafa0002', 'dddddddd-0000-4000-8000-dddddddd0011', 'act_9002', 'Conta B');
insert into public.whatsapp_groups (workspace_id, jid, name, participants) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '120363000000000001@g.us', 'Cliente A', 4),
  ('dddddddd-0000-4000-8000-dddddddd0011', '120363000000000002@g.us', 'Cliente B', 3);
insert into public.whatsapp_sessions (workspace_id, status) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ready') on conflict (workspace_id) do nothing;
insert into public.report_targets (id, workspace_id, ad_account_id, group_jid, group_name) values
  ('fafafafa-0000-4000-8000-fafafafa0010', 'dddddddd-0000-4000-8000-dddddddd0011', 'fafafafa-0000-4000-8000-fafafafa0002', '120363000000000002@g.us', 'Cliente B');
insert into public.reports (id, workspace_id, ad_account_id, title, period_since, period_until, payload, status) values
  ('fafafafa-0000-4000-8000-fafafafa0020', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fafafafa-0000-4000-8000-fafafafa0001', 'Rel A', '2026-11-16', '2026-11-22', '{}', 'rascunho'),
  ('fafafafa-0000-4000-8000-fafafafa0021', 'dddddddd-0000-4000-8000-dddddddd0011', 'fafafafa-0000-4000-8000-fafafafa0002', 'Rel B', '2026-11-16', '2026-11-22', '{}', 'rascunho');

-- Grupos: membros leem; ninguém do painel escreve ---------------------------------
select pg_temp.chk('grupos: editor A lê os de A', '33333333-3333-4333-8333-333333333333', $q$select 1 from public.whatsapp_groups$q$, 'rows:1');
select pg_temp.chk('grupos: owner B não lê os de A', 'dddddddd-0000-4000-8000-dddddddd0012', $q$select 1 from public.whatsapp_groups where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'rows:0');
select pg_temp.chk('grupos: owner A não insere (só o robô)', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.whatsapp_groups (workspace_id, jid, name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '120363000000000009@g.us', 'X')$q$, 'deny');
select pg_temp.chk('grupos: owner A não renomeia', '11111111-1111-4111-8111-111111111111', $q$update public.whatsapp_groups set name = 'X'$q$, 'deny');
select pg_temp.chk('grupos: anon não lê', null, $q$select 1 from public.whatsapp_groups$q$, 'deny');

-- Sessão: pedir leitura dos grupos (grant por coluna) -----------------------------
select pg_temp.chk('sessão: owner A pede leitura dos grupos', '11111111-1111-4111-8111-111111111111',
  $q$update public.whatsapp_sessions set groups_sync_requested_at = now() where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'ok');
select pg_temp.chk('sessão: owner A NÃO forja groups_synced_at', '11111111-1111-4111-8111-111111111111',
  $q$update public.whatsapp_sessions set groups_synced_at = now() where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');

-- report_targets ------------------------------------------------------------------
select pg_temp.chk('alvo: editor A configura a conta de A', '33333333-3333-4333-8333-333333333333',
  $q$insert into public.report_targets (workspace_id, ad_account_id, group_jid, group_name, campaign_mode) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fafafafa-0000-4000-8000-fafafafa0001', '120363000000000001@g.us', 'Cliente A', 'separate')$q$, 'ok');
select pg_temp.chk('alvo: visualizador A não configura', '44444444-4444-4444-8444-444444444444',
  $q$update public.report_targets set campaign_mode = 'merged' where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('alvo: owner A não aponta para conta de B', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.report_targets (workspace_id, ad_account_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fafafafa-0000-4000-8000-fafafafa0002')$q$, 'deny');
select pg_temp.chk('alvo: owner A não lê o de B', '11111111-1111-4111-8111-111111111111', $q$select 1 from public.report_targets where workspace_id = 'dddddddd-0000-4000-8000-dddddddd0011'$q$, 'rows:0');
select pg_temp.chk('alvo: grupo com jid inválido é recusado', '11111111-1111-4111-8111-111111111111',
  $q$update public.report_targets set group_jid = '5511999990000@s.whatsapp.net' where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('alvo: editor A não apaga (só dono/coordenador)', '33333333-3333-4333-8333-333333333333',
  $q$delete from public.report_targets where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');

-- reports ---------------------------------------------------------------------------
select pg_temp.chk('relatório: visualizador A lê o histórico de A', '44444444-4444-4444-8444-444444444444', $q$select 1 from public.reports$q$, 'rows:1');
select pg_temp.chk('relatório: owner B não lê os de A', 'dddddddd-0000-4000-8000-dddddddd0012', $q$select 1 from public.reports where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'rows:0');
select pg_temp.chk('relatório: editor A enfileira no grupo', '33333333-3333-4333-8333-333333333333',
  $q$insert into public.reports (workspace_id, ad_account_id, title, period_since, period_until, payload, status, group_jid, scheduled_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fafafafa-0000-4000-8000-fafafafa0001', 'Rel', '2026-11-16', '2026-11-22', '{}', 'agendado', '120363000000000001@g.us', now())$q$, 'ok');
select pg_temp.chk('relatório: visualizador A não marca como enviado', '44444444-4444-4444-8444-444444444444',
  $q$update public.reports set status = 'enviado' where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('relatório: owner A não altera o de B', '11111111-1111-4111-8111-111111111111',
  $q$update public.reports set status = 'cancelado' where id = 'fafafafa-0000-4000-8000-fafafafa0021'$q$, 'deny');
select pg_temp.chk('relatório: owner A não grava com conta de B', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.reports (workspace_id, ad_account_id, title, period_since, period_until, payload) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'fafafafa-0000-4000-8000-fafafafa0002', 'X', '2026-11-16', '2026-11-22', '{}')$q$, 'deny');
select pg_temp.chk('relatório: status inválido é recusado', '11111111-1111-4111-8111-111111111111',
  $q$update public.reports set status = 'lido' where id = 'fafafafa-0000-4000-8000-fafafafa0020'$q$, 'deny');
select pg_temp.chk('relatório: anon não lê', null, $q$select 1 from public.reports$q$, 'deny');

-- report_schedules / report_settings --------------------------------------------------
select pg_temp.chk('agenda: editor A cria', '33333333-3333-4333-8333-333333333333',
  $q$insert into public.report_schedules (workspace_id, name, days_of_week, send_time, target_ids, next_run_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Semanal', '{1}', '09:00', array['fafafafa-0000-4000-8000-fafafafa0010']::uuid[], now())$q$, 'ok');
select pg_temp.chk('agenda: intervalo < 20 s é recusado', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.report_schedules (workspace_id, name, days_of_week, send_time, target_ids, interval_min_seconds) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X', '{1}', '09:00', array['fafafafa-0000-4000-8000-fafafafa0010']::uuid[], 5)$q$, 'deny');
select pg_temp.chk('agenda: dia inválido é recusado', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.report_schedules (workspace_id, name, days_of_week, send_time, target_ids) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X', '{7}', '09:00', array['fafafafa-0000-4000-8000-fafafafa0010']::uuid[])$q$, 'deny');
select pg_temp.chk('agenda: editor A não apaga', '33333333-3333-4333-8333-333333333333', $q$delete from public.report_schedules where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('agenda: coordenador A apaga', '22222222-2222-4222-8222-222222222222', $q$delete from public.report_schedules where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'ok');
select pg_temp.chk('modelo: owner A salva', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.report_settings (workspace_id, interval_min_seconds, interval_max_seconds) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 120, 300)$q$, 'ok');
select pg_temp.chk('modelo: owner B não lê o de A', 'dddddddd-0000-4000-8000-dddddddd0012', $q$select 1 from public.report_settings where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'rows:0');

-- Cascatas (superusuário) ---------------------------------------------------------------
delete from public.ad_accounts where id = 'fafafafa-0000-4000-8000-fafafafa0001';
insert into r (test, pass, detail)
select 'FK: apagar conta mantém o histórico (ad_account_id nulo)', count(*) = 2, 'relatórios=' || count(*)
from public.reports where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and ad_account_id is null;
insert into r (test, pass, detail)
select 'FK: apagar conta remove a configuração dela', count(*) = 0, 'alvos=' || count(*)
from public.report_targets where ad_account_id = 'fafafafa-0000-4000-8000-fafafafa0001';

insert into r (test, pass, detail)
select 'RLS ligado: ' || tablename, rowsecurity, null from pg_tables
where schemaname = 'public' and tablename in ('whatsapp_groups', 'report_targets', 'report_settings', 'report_schedules', 'reports');

select id, pass, test, detail from r order by id;
select count(*) as total, count(*) filter (where pass) as ok, count(*) filter (where not pass) as falhas from r;

rollback;
