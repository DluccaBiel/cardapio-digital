# Validação do banco (Fase 1) — `supabase/migrations/0001_init.sql` + `0002_rls.sql`

Status: **APROVADO em ambiente local (não-produção)**. Data: 04/11/2026.
Banco de teste: **Supabase local (Docker Desktop + `supabase start`)**, Postgres 17,
schema `public` criado do zero a partir das migrations. Nenhum dado real. Nunca produção.

## Como executar (local)

```bash
# Pré-requisito: Docker Desktop rodando + CLI como devDependency (npm i -D supabase)
npx supabase start
npx supabase db reset        # aplica 0001 + 0002 + seed.sql (dados fictícios)

# Testes de isolamento (70 testes, esperado: 70 pass / 0 fail)
docker exec -i supabase_db_$(basename $(pwd) | tr '[:lower:]' '[:upper:]') psql -U postgres < supabase/tests/rls_isolation.sql
# ou descubra o container: docker ps --format '{{.Names}}'   # ex.: supabase_db_CRMCARDAPIO

# Checagens de higiene
docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/checks.sql
```

Resultado dos testes (04/11/2026): **70/70 PASS** (`public.test_rls_results`, removida ao final).

### Sem Docker — Plano B (⚠️ somente projeto Supabase de DESENVOLVIMENTO, nunca produção)

1. Crie um **projeto free descartável** no Supabase (ex.: `orvia-dev-throwaway`).
2. Abra o **SQL Editor** e rode, em ordem:
   - conteúdo de `supabase/validate/all.sql` (0001 → 0002 → seed → checks → 70 testes)
   - *ou* rode `0001_init.sql`, `0002_rls.sql`, `seed.sql`, `checks.sql`, `rls_isolation.sql` separadamente.
3. Verifique no fim: `select count(*) filter (where pass), count(*) filter (where not pass) from public.test_rls_results;` → `70 | 0`.
4. **Apague o projeto** ao terminar (Settings → General → Delete project). O script `all.sql` contém dados FICTÍCIOS; mesmo assim não use projeto com dados reais.
5. Observações: o teste insere fixtures em `auth.users`/`storage.objects` (permitido no SQL Editor na maioria dos projetos, mas pode falhar com erro de permissão em projetos mais restritos — nesse caso, crie os 5 usuários demo pelo painel Authentication e aponte os mesmos UUIDs, ou use o caminho com Docker, que é o recomendado). O objeto de storage de teste NÃO é apagado (deletar `storage.objects` por SQL é proibido pelo Supabase; use a Storage API ou ignore).

Nexus de evidência local: `supabase db reset` aplicou `0001` e `0002` **sem nenhum erro de sintaxe**; testes convenientes validados 2× (antes e depois das correções de FK).

## O que passou

| Área | Resultado |
|---|---|
| Migration `0001_init.sql` aplica limpa do zero (19 tabelas) | ✅ |
| Migration `0002_rls.sql` aplica limpa do zero (64 políticas, 3 funções defasadas com `set search_path`) | ✅ |
| **Isolamento de leitura entre workspaces** — visualizador A não vê 1 linha sequer do ws B em 18 tabelas + workspaces; owner B idem (simétrico) | ✅ 36 asserts |
| **Isolamento de escrita** — editor A: INSERT cruzado bloqueado; UPDATE/DELETE cruzado = 0 linhas | ✅ |
| **Visualizador só lê** — 6 escritas (clients, itens, categorias, subitens, tags, imagens) bloqueadas | ✅ |
| **Editor não administra** — membros, api_keys, webhooks (insert/select), extension_installs, ad_accounts (insert) | ✅ |
| **api_keys** — coordenador não deleta (só owner), editor/viewer não veem linhas; insert por editor bloqueado | ✅ |
| **Coordenador** — pode adicionar editor, não pode criar `owner` | ✅ |
| **Owner** — pode tudo no próprio workspace, **0 linhas afetadas cruzado** (delete members, update workspaces) | ✅ |
| **menu_image_history** — owner insere (fluxo de troca funciona), **ninguém** dá update/delete | ✅ |
| **audit_log** — nenhum usuário autenticado insere/altera/apaga (só service_role/servidor) | ✅ |
| **Storage `menu-images`** — ver prefixo do próprio workspace; ws alheio invisível; **UUID malformado não vaza nem dispara erro** (função `storage_workspace_id` com guard); INSERT por authenticated bloqueado | ✅ |
| Tabelas `public` sem RLS | **0** ✅ |
| Tabelas `public` sem policy | **0** ✅ |
| Funções `security definer` sem `set search_path` | **0** ✅ |
| FKs `public` sem índice | **0** (após correção — ver abaixo) ✅ |
| Resumo: 19 tabelas públicas · **63 policies no schema public** (+1 policy `storage_menu_images_select` sobre `storage.objects`) · 3 funções security definer | ✅ |

## Falhas encontradas e correções (registradas)

1. **8 FKs sem índice** (`menu_subitems.workspace_id`, `webhook_deliveries.workspace_id`, `api_keys.created_by`, `extension_installs.installed_by`, `webhooks.created_by`, `members.invited_by`, `menu_images.created_by`, `menu_image_history.menu_image_id`) — detectadas pelo `checks.sql` (seção 4). Correção: 8 `CREATE INDEX` adicionados diretamente em `0001_init.sql` (permitido: as migrations nunca foram aplicadas em banco remoto). Após a correção, a seção 4 lista apenas FKs internas de `auth.*`/`storage.*` (Supabase-internal, aceitas; não são nossas).
2. **`seed.sql` (primeiro rascunho)** — expressão aritmética em UUID (`'…991' + 1 || 'x'`) inválida → corrigido para UUID literal `99999999-9999-4999-8999-999999999992`.
3. **`checks.sql` (primeiro rascunho)** — query de contagem usava `pg_policies.polrelid` (a view não expõe a coluna) → corrigido para `pg_policy join pg_class`.
4. **Teste de limpeza de Storage** — `DELETE FROM storage.objects` é **bloqueado pelo próprio Supabase** (trigger `storage.protect_delete`, anti-orfãos). Correção: o teste não apaga objetos; fixtures somem no próximo `supabase db reset`. Não é um problema do schema.
5. **Variáveis de teste JWT simuladas** — `auth.uid()` no stack local lê `request.jwt.claim.sub` (singular) e há também `request.jwt.claims` como JSON; o teste seta ambos. Documentado no cabeçalho do arquivo de testes.

Nenhuma correção tocou regras de negócio; nenhuma tabela/coluna/enum foi renomeada; nenhum objeto de produção; nenhuma RLS afrouxada (o teste confirmou bloqueios, não apenas permissões).

## Riscos restantes / decisões em aberto

1. **`supabase start` exige Docker Desktop rodando** — estava instalado mas desligado; foi iniciado (decisão operacional). Em máquinas sem Docker, use o Plano B (dev project descartável). **Studio local**: http://127.0.0.1:54323.
2. **docker exec depende do nome do container** — muda conforme pasta do projeto (`supabase_db_<PASTA>`); descubra com `docker ps`.
3. **Testes simulam JWT na sessão** (`set local role` + `request.jwt.claim*`), não testam o gateway HTTP (PostgREST/GoTrue). O isolamento via HTTP é garantido pelo RLS + mesma política, mas um smoke test via `curl` autenticado fica como próximo passo.
4. **`extension_installs`/`webhooks` não têm fixtures de dados** no seed; os asserts confirmaram bloqueio de escrita e leitura vazia, o que é suficiente para estas políticas.
5. **`menu_item_addon_groups` tem `workspace_id` denormalizado** e não há trigger forçando igualdade com `menu_items.workspace_id` — um service_role bugado poderia divergir. Recomendação: trigger de consistência em migration futura (`0003`).
6. **FK ausente:** `menu_images.owner_id`/`menu_image_history.owner_id` "polimórficos" sem FK por design — integridade garantida pela aplicação; avaliar trigger de validação.
7. **Backup antes de qualquer `db push`**: use `npx supabase db dump --local > backups/pre_push_$(date +%F).sql`, OU snapshot via dashboard antes de `supabase db push` em projeto remoto. Nunca rode `db push` direto em produção sem backup e staging.
8. **`.env.example` e o `supabase/config.toml` gerado** — config.toml contém credenciais locais padrão (`127.0.0.1`), seguras; nunca cole chaves reais ali.

## Arquivos envolvidos

- `supabase/migrations/0001_init.sql` (índices adicionados)
- `supabase/migrations/0002_rls.sql` (inalterada nesta etapa — já estava correta)
- `supabase/seed.sql` (dados fictícios; aplicado por `db reset`)
- `supabase/tests/rls_isolation.sql` (70 testes, puro SQL)
- `supabase/tests/checks.sql` (higiene do schema)
- `supabase/validate/all.sql` (gerado: 0001+0002+seed+checks+tests para o Plano B)
- `AGENTS.md` (comandos de banco atualizados)
