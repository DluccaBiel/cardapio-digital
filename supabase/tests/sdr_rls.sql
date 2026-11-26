-- ============================================================================
-- sdr_rls.sql — RLS/constraints das tabelas do SDR no WhatsApp (20261120120000)
-- Requer: todas as migrations + seed.sql (workspace demo A: owner 1111, coordenador 2222,
-- editor 3333, visualizador 4444). Rodar LOCAL como superusuário; tudo em ROLLBACK.
--   docker exec -i supabase_db_<PASTA> psql -U postgres < supabase/tests/sdr_rls.sql
-- Esperado: resumo "falhas = 0".
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

-- Fixtures ----------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('dddddddd-0000-4000-8000-dddddddd0102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-sdr-b@undercut-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug, plan) values ('dddddddd-0000-4000-8000-dddddddd0101', 'Workspace B (SDR)', 'sdr-test-b', 'free') on conflict (id) do nothing;
insert into public.members (workspace_id, user_id, role) values ('dddddddd-0000-4000-8000-dddddddd0101', 'dddddddd-0000-4000-8000-dddddddd0102', 'owner') on conflict do nothing;

insert into public.prospect_leads (id, workspace_id, name, phone, source) values
  ('eeeeeeee-0000-4000-8000-eeeeeeee0101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Lead A', '5519991110001', 'whatsapp'),
  ('eeeeeeee-0000-4000-8000-eeeeeeee0102', 'dddddddd-0000-4000-8000-dddddddd0101', 'Lead B', '5519991110002', 'manual');
insert into public.sdr_settings (workspace_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.sdr_messages (workspace_id, lead_id, direction, body, sent_by, wa_message_id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'in', 'Oi, quero saber mais', 'lead', 'wamid-1');
insert into public.sdr_cadences (id, workspace_id, name, stage, steps) values
  ('eeeeeeee-0000-4000-8000-eeeeeeee0103', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Primeiro contato', 'novo', '[{"wait_hours":0,"body":"Olá, {nome}!"}]');
insert into public.sdr_notes (workspace_id, lead_id, body) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'Ligar amanhã');

-- Funil (prospect_leads) ------------------------------------------------------------
select pg_temp.chk('lead: editor A move no funil', '33333333-3333-4333-8333-333333333333',
  $q$update public.prospect_leads set stage = 'respondeu' where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0101'$q$, 'ok');
select pg_temp.chk('lead: visualizador A não move', '44444444-4444-4444-8444-444444444444',
  $q$update public.prospect_leads set stage = 'perdido' where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0101'$q$, 'deny');
select pg_temp.chk('lead: owner B não move lead de A', 'dddddddd-0000-4000-8000-dddddddd0102',
  $q$update public.prospect_leads set stage = 'perdido' where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0101'$q$, 'deny');
select pg_temp.chk('lead: etapa inválida recusada', '11111111-1111-4111-8111-111111111111',
  $q$update public.prospect_leads set stage = 'xyz' where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0101'$q$, 'deny');
select pg_temp.chk('lead: score > 100 recusado', '11111111-1111-4111-8111-111111111111',
  $q$update public.prospect_leads set score = 150 where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0101'$q$, 'deny');

-- Configurações -----------------------------------------------------------------------
select pg_temp.chk('config: coordenador A altera', '22222222-2222-4222-8222-222222222222',
  $q$update public.sdr_settings set daily_new_contacts = 40 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'ok');
select pg_temp.chk('config: editor A NÃO altera', '33333333-3333-4333-8333-333333333333',
  $q$update public.sdr_settings set ai_enabled = true where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('config: limite diário > 300 recusado', '11111111-1111-4111-8111-111111111111',
  $q$update public.sdr_settings set daily_new_contacts = 999 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('config: intervalo < 20 s recusado', '11111111-1111-4111-8111-111111111111',
  $q$update public.sdr_settings set interval_min_seconds = 5 where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('config: owner B não lê a de A', 'dddddddd-0000-4000-8000-dddddddd0102',
  $q$select 1 from public.sdr_settings where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'rows:0');

-- Mensagens -------------------------------------------------------------------------------
select pg_temp.chk('mensagens: visualizador A lê', '44444444-4444-4444-8444-444444444444',
  $q$select 1 from public.sdr_messages$q$, 'rows:1');
select pg_temp.chk('mensagens: owner B não lê as de A', 'dddddddd-0000-4000-8000-dddddddd0102',
  $q$select 1 from public.sdr_messages$q$, 'rows:0');
select pg_temp.chk('mensagens: anon não lê', null, $q$select 1 from public.sdr_messages$q$, 'deny');
select pg_temp.chk('mensagens: editor A não apaga', '33333333-3333-4333-8333-333333333333',
  $q$delete from public.sdr_messages$q$, 'deny');

-- Tarefas / cadências / notas / respostas rápidas -------------------------------------------
select pg_temp.chk('tarefa: editor A cria envio manual', '33333333-3333-4333-8333-333333333333',
  $q$insert into public.sdr_tasks (workspace_id, lead_id, kind, body, respects_window) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'manual', 'Oi!', false)$q$, 'ok');
select pg_temp.chk('tarefa: visualizador A não cria', '44444444-4444-4444-8444-444444444444',
  $q$insert into public.sdr_tasks (workspace_id, lead_id, kind, body) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'manual', 'Oi!')$q$, 'deny');
select pg_temp.chk('tarefa: owner B não cria para lead de A', 'dddddddd-0000-4000-8000-dddddddd0102',
  $q$insert into public.sdr_tasks (workspace_id, lead_id, kind, body) values ('dddddddd-0000-4000-8000-dddddddd0101', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'manual', 'Oi!')$q$, 'deny');
select pg_temp.chk('tarefa: tipo inválido recusado', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.sdr_tasks (workspace_id, lead_id, kind, body) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'spam', 'x')$q$, 'deny');
select pg_temp.chk('cadência: editor A edita', '33333333-3333-4333-8333-333333333333',
  $q$update public.sdr_cadences set active = false where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0103'$q$, 'ok');
select pg_temp.chk('cadência: steps precisa ser lista', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.sdr_cadences (workspace_id, name, stage, steps) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X', 'novo', '{"a":1}')$q$, 'deny');
select pg_temp.chk('nota: editor A cria lembrete', '33333333-3333-4333-8333-333333333333',
  $q$insert into public.sdr_notes (workspace_id, lead_id, body, remind_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'Retornar', now() + interval '1 day')$q$, 'ok');
select pg_temp.chk('nota: owner B não lê as de A', 'dddddddd-0000-4000-8000-dddddddd0102',
  $q$select 1 from public.sdr_notes$q$, 'rows:0');
select pg_temp.chk('resposta rápida: editor A cria', '33333333-3333-4333-8333-333333333333',
  $q$insert into public.sdr_quick_replies (workspace_id, stage, title, body) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'novo', 'Saudação', 'Olá, {nome}!')$q$, 'ok');

-- FK composta: lead de B não entra em mensagem de A (superusuário, ignora RLS)
do $$ declare ok boolean; msg text; begin
  begin
    insert into public.sdr_messages (workspace_id, lead_id, direction, body, sent_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0102', 'in', 'x', 'lead');
    ok := false; msg := 'aceitou';
  exception when foreign_key_violation then ok := true; msg := sqlerrm; end;
  insert into r (test, pass, detail) values ('FK: mensagem com lead de outro workspace', ok, msg);
end $$;

-- 1 cadência ativa por lead
do $$ declare ok boolean; msg text; begin
  insert into public.sdr_enrollments (workspace_id, lead_id, cadence_id, next_run_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'eeeeeeee-0000-4000-8000-eeeeeeee0103', now());
  begin
    insert into public.sdr_enrollments (workspace_id, lead_id, cadence_id, next_run_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0101', 'eeeeeeee-0000-4000-8000-eeeeeeee0103', now());
    ok := false; msg := 'aceitou duas ativas';
  exception when unique_violation then ok := true; msg := sqlerrm; end;
  insert into r (test, pass, detail) values ('cadência: só 1 ativa por lead', ok, msg);
end $$;

-- Catálogo + RLS ligado
insert into r (test, pass, detail) select 'catálogo: extensão undercut-sdr registrada', count(*) = 1, null from public.extensions where slug = 'undercut-sdr';
insert into r (test, pass, detail)
select 'RLS ligado: ' || tablename, rowsecurity, null from pg_tables
where schemaname = 'public' and tablename in ('sdr_settings', 'sdr_messages', 'sdr_cadences', 'sdr_enrollments', 'sdr_tasks', 'sdr_notes', 'sdr_quick_replies');

select id, pass, test, detail from r order by id;
select count(*) as total, count(*) filter (where pass) as ok, count(*) filter (where not pass) as falhas from r;

rollback;
