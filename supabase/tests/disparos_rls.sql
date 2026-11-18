-- ============================================================================
-- disparos_rls.sql — RLS/grants/constraints das tabelas de Disparos WhatsApp
-- Requer: todas as migrations + seed.sql (workspace demo A com owner/coordenador/editor/visualizador).
-- Rodar LOCAL como superusuário; tudo em transação com ROLLBACK (não deixa resíduo).
--   docker exec -i supabase_db_<PASTA> psql -U postgres < supabase/tests/disparos_rls.sql
-- Esperado: todas as linhas pass = t e o resumo "falhas = 0".
-- ============================================================================

begin;

create temp table r (id serial, test text, pass boolean, detail text);

-- Executa `q` como o usuário `uid` (null = anon) e confere a expectativa:
--   'ok'     → executou e afetou ≥ 1 linha        'deny' → erro OU 0 linhas afetadas
--   'rows:N' → a consulta devolve exatamente N linhas
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
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values ('dddddddd-0000-4000-8000-dddddddd0002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-disparos-b@orvia-demo.example', '$2a$10$abcdefghijklmnopqrstuuVZ2FkW5O0pAOyKiP2k2T3o3m0c1b1a6fW', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}')
on conflict (id) do nothing;
insert into public.workspaces (id, name, slug, plan) values ('dddddddd-0000-4000-8000-dddddddd0001', 'Workspace B (Disparos)', 'disparos-test-b', 'free') on conflict (id) do nothing;
insert into public.members (workspace_id, user_id, role) values ('dddddddd-0000-4000-8000-dddddddd0001', 'dddddddd-0000-4000-8000-dddddddd0002', 'owner') on conflict do nothing;

insert into public.prospect_searches (id, workspace_id, city, uf, status) values
  ('eeeeeeee-0000-4000-8000-eeeeeeee0001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Campinas', 'SP', 'concluida');
insert into public.prospect_leads (id, workspace_id, name, phone, city, uf, search_id) values
  ('eeeeeeee-0000-4000-8000-eeeeeeee0002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Burger Teste', '5519991234567', 'Campinas', 'SP', 'eeeeeeee-0000-4000-8000-eeeeeeee0001');
insert into public.broadcast_campaigns (id, workspace_id, name, message, start_date, days_of_week, window_start, window_end, interval_min_seconds, interval_max_seconds, total) values
  ('eeeeeeee-0000-4000-8000-eeeeeeee0003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Teste', 'Olá {nome}', current_date, '{1,2,3,4,5}', '09:00', '18:00', 60, 180, 1);
insert into public.broadcast_recipients (id, workspace_id, campaign_id, lead_id, name, phone) values
  ('eeeeeeee-0000-4000-8000-eeeeeeee0004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-0000-4000-8000-eeeeeeee0003', 'eeeeeeee-0000-4000-8000-eeeeeeee0002', 'Burger Teste', '5519991234567');
insert into public.whatsapp_sessions (workspace_id, status, phone) values ('dddddddd-0000-4000-8000-dddddddd0001', 'ready', '5511999990000');

-- whatsapp_sessions -------------------------------------------------------------
select pg_temp.chk('sessão: owner A pede conexão (insert)', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.whatsapp_sessions (workspace_id, desired_state) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'connected')$q$, 'ok');
select pg_temp.chk('sessão: coordenador A altera desired_state', '22222222-2222-4222-8222-222222222222',
  $q$update public.whatsapp_sessions set desired_state = 'disconnected' where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'ok');
select pg_temp.chk('sessão: owner A NÃO forja status (grant por coluna)', '11111111-1111-4111-8111-111111111111',
  $q$update public.whatsapp_sessions set status = 'ready' where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('sessão: owner A NÃO grava qr/phone no insert', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.whatsapp_sessions (workspace_id, phone) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '5500000000000')$q$, 'deny');
select pg_temp.chk('sessão: owner A lê a própria', '11111111-1111-4111-8111-111111111111',
  $q$select 1 from public.whatsapp_sessions$q$, 'rows:1');
select pg_temp.chk('sessão: editor A não lê (só dono/coordenador)', '33333333-3333-4333-8333-333333333333',
  $q$select 1 from public.whatsapp_sessions$q$, 'rows:0');
select pg_temp.chk('sessão: owner B não vê a de A', 'dddddddd-0000-4000-8000-dddddddd0002',
  $q$select 1 from public.whatsapp_sessions where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'rows:0');
select pg_temp.chk('sessão: owner A não mexe na de B', '11111111-1111-4111-8111-111111111111',
  $q$update public.whatsapp_sessions set desired_state = 'connected' where workspace_id = 'dddddddd-0000-4000-8000-dddddddd0001'$q$, 'deny');
select pg_temp.chk('sessão: owner A não apaga', '11111111-1111-4111-8111-111111111111',
  $q$delete from public.whatsapp_sessions where workspace_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$q$, 'deny');
select pg_temp.chk('sessão: anon não lê', null, $q$select 1 from public.whatsapp_sessions$q$, 'deny');

-- prospect_searches / prospect_leads ------------------------------------------------
select pg_temp.chk('pesquisa: owner A cria', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.prospect_searches (workspace_id, city) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Valinhos')$q$, 'ok');
select pg_temp.chk('pesquisa: visualizador A não cria', '44444444-4444-4444-8444-444444444444',
  $q$insert into public.prospect_searches (workspace_id, city) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Valinhos')$q$, 'deny');
select pg_temp.chk('pesquisa: owner B não cria em A', 'dddddddd-0000-4000-8000-dddddddd0002',
  $q$insert into public.prospect_searches (workspace_id, city) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Valinhos')$q$, 'deny');
select pg_temp.chk('lead: visualizador A lê', '44444444-4444-4444-8444-444444444444',
  $q$select 1 from public.prospect_leads$q$, 'rows:1');
select pg_temp.chk('lead: visualizador A não edita', '44444444-4444-4444-8444-444444444444',
  $q$update public.prospect_leads set status = 'opt_out'$q$, 'deny');
select pg_temp.chk('lead: owner B não lê os de A', 'dddddddd-0000-4000-8000-dddddddd0002',
  $q$select 1 from public.prospect_leads$q$, 'rows:0');
select pg_temp.chk('lead: owner A não duplica telefone', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.prospect_leads (workspace_id, name, phone) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Dup', '5519991234567')$q$, 'deny');
select pg_temp.chk('lead: telefone inválido recusado', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.prospect_leads (workspace_id, name, phone) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'X', '+55 19 9')$q$, 'deny');
select pg_temp.chk('lead: anon não lê', null, $q$select 1 from public.prospect_leads$q$, 'deny');

-- campanhas / destinatários ------------------------------------------------------------
select pg_temp.chk('campanha: coordenador A pausa', '22222222-2222-4222-8222-222222222222',
  $q$update public.broadcast_campaigns set status = 'pausada' where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0003'$q$, 'ok');
select pg_temp.chk('campanha: editor A não altera', '33333333-3333-4333-8333-333333333333',
  $q$update public.broadcast_campaigns set status = 'agendada' where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0003'$q$, 'deny');
select pg_temp.chk('campanha: intervalo < 20 s recusado', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.broadcast_campaigns (workspace_id, name, message, start_date, days_of_week, window_start, window_end, interval_min_seconds, interval_max_seconds) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'R', 'm', current_date, '{1}', '09:00', '18:00', 5, 10)$q$, 'deny');
select pg_temp.chk('campanha: janela invertida recusada', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.broadcast_campaigns (workspace_id, name, message, start_date, days_of_week, window_start, window_end, interval_min_seconds, interval_max_seconds) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'R', 'm', current_date, '{1}', '18:00', '09:00', 60, 120)$q$, 'deny');
select pg_temp.chk('campanha: dia da semana 7 recusado', '11111111-1111-4111-8111-111111111111',
  $q$insert into public.broadcast_campaigns (workspace_id, name, message, start_date, days_of_week, window_start, window_end, interval_min_seconds, interval_max_seconds) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'R', 'm', current_date, '{7}', '09:00', '18:00', 60, 120)$q$, 'deny');
select pg_temp.chk('destinatário: visualizador A lê', '44444444-4444-4444-8444-444444444444',
  $q$select 1 from public.broadcast_recipients$q$, 'rows:1');
select pg_temp.chk('destinatário: owner B não lê os de A', 'dddddddd-0000-4000-8000-dddddddd0002',
  $q$select 1 from public.broadcast_recipients$q$, 'rows:0');
select pg_temp.chk('destinatário: owner B não injeta na campanha de A', 'dddddddd-0000-4000-8000-dddddddd0002',
  $q$insert into public.broadcast_recipients (workspace_id, campaign_id, name, phone) values ('dddddddd-0000-4000-8000-dddddddd0001', 'eeeeeeee-0000-4000-8000-eeeeeeee0003', 'X', '5511988887777')$q$, 'deny');

-- FK composta (superusuário, ignora RLS): campanha de A não aceita destinatário de B
do $$ declare ok boolean; msg text; begin
  begin
    insert into public.broadcast_recipients (workspace_id, campaign_id, name, phone)
    values ('dddddddd-0000-4000-8000-dddddddd0001', 'eeeeeeee-0000-4000-8000-eeeeeeee0003', 'X', '5511988887777');
    ok := false; msg := 'aceitou';
  exception when foreign_key_violation then ok := true; msg := sqlerrm; end;
  insert into r (test, pass, detail) values ('FK: destinatário de B na campanha de A (superusuário)', ok, msg);
end $$;

-- Cascata: apagar a pesquisa solta o lead (search_id = null), sem apagar
delete from public.prospect_searches where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0001';
insert into r (test, pass, detail)
select 'FK: apagar pesquisa mantém o lead com search_id nulo', count(*) = 1, 'leads=' || count(*)
from public.prospect_leads where id = 'eeeeeeee-0000-4000-8000-eeeeeeee0002' and search_id is null;

-- RLS ligado em todas as tabelas novas
insert into r (test, pass, detail)
select 'RLS ligado: ' || tablename, rowsecurity, null from pg_tables
where schemaname = 'public' and tablename in ('whatsapp_sessions', 'prospect_searches', 'prospect_leads', 'broadcast_campaigns', 'broadcast_recipients');

select id, pass, test, detail from r order by id;
select count(*) as total, count(*) filter (where pass) as ok, count(*) filter (where not pass) as falhas from r;

rollback;
