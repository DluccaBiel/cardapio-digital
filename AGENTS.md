# AGENTS.md — Orvia (Fase 1)

> Este arquivo vale para **toda sessão** de agente neste repositório. Leia antes de agir.

## 📋 Stack

- **Frontend/painel:** Next.js (App Router) + TypeScript + CSS (app/globals.css; tokens em packages/brand) — tema escuro, destaque azul Orvia (#3D8EFF), tabelas densas, rotas `/a/{workspace}/...`
- **Backend:** Route Handlers do Next.js (`app/api/v1/...`) + Supabase (service role só no servidor)
- **Banco:** Supabase (PostgreSQL 15+) + **RLS em todas as tabelas**
- **Storage:** Supabase Storage, bucket privado `menu-images`
- **Auth:** Supabase Auth (painel) + chaves de API com escopos (extensões)
- **Hospedagem:** Vercel (plano gratuito) + Supabase (plano gratuito)
- **Monorepo:** `apps/hub`, `apps/extensions/*`, `packages/api-types`, `supabase/migrations`, `docs`

## 📁 Estrutura

```text
├── apps/hub/               # App Next.js (Fase 1)
├── apps/extensions/        # Extensões Chrome MV3
├── packages/api-types/     # Tipos gerados a partir de docs/openapi.yaml
├── packages/brand/         # Fonte única da marca Orvia (nome, cores, logos) — ver packages/brand/README.md
├── supabase/migrations/    # 0001_init.sql, 0002_rls.sql, ...
├── docs/                   # Arquitetura (ver sumário abaixo)
├── AGENTS.md
└── .env.example            # ÚNICO arquivo de env versionado (placeholders)
```

## 🧩 Comandos

```bash
# Desenvolvimento
npm run dev            # sobe o hub em http://localhost:3000
npm run build          # build de produção
npm run lint           # eslint + tsc --noEmit
npm test               # vitest run tests (modo gratuito da análise + testes da extensão iFood)

# Banco / migrations (Supabase CLI como devDependency: npm i -D supabase; Docker Desktop necessário)
npx supabase start           # sobe o stack local (Postgres + API + Studio em http://127.0.0.1:54323)
npx supabase db reset        # recria o banco local (0001…0004 + seed.sql, com dados FICTÍCIOS)
npx supabase stop            # derruba o stack local
npx supabase db dump --local > backups/pre-migration_$(date +%F).sql   # SEMPRE antes de migrar produção

# Testes de banco (LOCAL apenas — nunca produção):
docker ps --format '{{.Names}}'                                     # descubra o container: supabase_db_<PASTA>
docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/rls_isolation.sql   # 70 testes RLS (esperado 70/0)
docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/rls_cross_link.sql  # 20 testes cross-link (20/0)
docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/checks.sql          # higiene (0 problemas)
docker exec -i supabase_db_CRMCARDAPIO psql -U postgres < supabase/tests/combos_ifood.sql    # 16 testes combos/iFood (16/0)
# API + painel + extensão (hub local em :3100 apontando para o Supabase local, envs só no processo):
#   node supabase/tests/api_menu.mjs (34/34) → node scripts/e2e-cardapio.mjs (9/9) → (apps/extensions/orvia-ifood) node scripts/e2e.mjs (15/15)
# Smoke test HTTP (chaves descartáveis locais via env — NUNCA gravar em arquivos):
$s = npx supabase status -o env
$env:LOCAL_API_URL = (($s | Select-String '^API_URL=').Line -split '=',2)[1].Trim('"')
$env:LOCAL_ANON_KEY = (($s | Select-String '^ANON_KEY=').Line -split '=',2)[1].Trim('"')
$env:LOCAL_SERVICE_ROLE_KEY = (($s | Select-String '^SERVICE_ROLE_KEY=').Line -split '=',2)[1].Trim('"')
node supabase/tests/smoke.mjs    # 8 checks HTTP+RLS (esperado 8/8)
```

**Backup obrigatório:** antes de rodar qualquer migration em produção, gere `pg_dump`/`supabase db dump` ou snapshot no dashboard do Supabase. Teste as migrations primeiro em `supabase db reset` local.

## 🔐 Regras de segurança (obrigatório)

1. **Nunca commite `.env`** (ou `.env.local` etc.). Apenas `.env.example`, com placeholders. `.gitignore` cobre.
2. **Service role key só no servidor** (Route Handlers / Server Actions / cron). Nunca no frontend, na extensão ou em `NEXT_PUBLIC_*`.
3. **RLS ativo em todas as tabelas** — nunca desativar "por conveniência". Políticas em `supabase/migrations/0002_rls.sql`.
4. **Chaves de API só com hash** no banco (`api_keys.key_hash`); valor em claro exibido uma única vez na criação/rotação.
5. **If-Match obrigatório** em toda escrita da API pública (controle de edição concorrente). Sem ele → `428`.
6. **Validação de entrada** com Zod em toda rota; saída sanitizada; React escapa por padrão — `dangerouslySetInnerHTML` proibido sem sanitização explícita.
7. **Queries parametrizadas** (cliente Supabase). Zero SQL concatenado com entrada do usuário.
8. **Upload de imagens:** validar magic bytes, ≤ 5 MB, ≤ 4096px, converter para WebP, remover EXIF. Sem SVG.
9. **Webhooks de saída:** apenas HTTPS, proteção SSRF (bloquear faixas privadas), assinatura HMAC-SHA256.
10. **Segredos nunca em logs.** `audit_log` registra ações (ator, ação, entidade) — nunca valores sensíveis.
11. **LGPD:** campos pessoais marcados `[PII/LGPD]` no schema. Retenção: `audit_log.ip` 90 dias, demais audit 12 meses, `menu_image_history` 90 dias. Exclusão de workspace (`deleted_at` + job ≤ 30 dias) remove dados do Storage e tabelas em cascata. Ver `docs/fotos-e-historico.md` e `docs/decisoes-em-aberto.md`.

## 🗄️ Como criar uma migration

0. **Migrations são imutáveis após o primeiro `db push` em qualquer ambiente.** Correção é SEMPRE em nova migration (`0004_...sql`), nunca editando a antiga. (Antes de qualquer push, podem ser ajustadas — e foi o que fizemos com 0001/0002 na validação local.)
1. `npx supabase migration new <descricao_snake_case>`
2. Escreva o SQL: idempotente quando possível (`if not exists`, `on conflict do nothing`), sempre com `workspace_id` + índice, e RLS se for tabela nova.
3. Atualize `0002_rls.sql` (ou crie `0003_tenant_consistency.sql`/`000N_....sql` nos casos de alteração de FK/trigger) **no mesmo commit**.
4. Teste: `supabase db reset` local → roda todas as migrations do zero; depois `rls_isolation.sql`, `rls_cross_link.sql`, `checks.sql` e, se mexeu em policies/API, `smoke.mjs`.
5. Backup de produção → aplique (`supabase db push` ou `psql -f`) → confira `select tablename, rowsecurity from pg_tables where schemaname='public'`.

## 🧩 Como criar uma extensão

1. Crie `apps/extensions/<slug>/` com `manifest.json` MV3.
2. `host_permissions`: **somente** o domínio do hub (`https://seu-app.vercel.app/*`). Nunca hosts de terceiros.
3. `permissions`: mínimo necessário (`storage`); evite `<all_urls>` e `tabs` sem justificativa.
4. Chave de API em `chrome.storage.local`, entrada via options com campo senha; CORS do hub aceita `chrome-extension://<id>` (ver `docs/extensoes.md`).
5. Registre no catálogo: `INSERT INTO public.extensions (slug, name, description, homepage_url) VALUES (...)`.
6. Crie a chave no painel com **escopos mínimos**; teste `GET /api/v1/extensions/installs` e o `audit_log`.
7. README próprio da extensão com fluxo de conferência → aplicação → pausa → reversão.
8. Detalhes completos: `docs/extensoes.md`.

## 📚 Como documentar

- Toda decisão arquitetural vai para `docs/` — API em `api.md`/`openapi.yaml` (mantê-los **sincronizados**; o yaml é a fonte para `packages/api-types`).
- Decisões e riscos em aberto: `docs/decisoes-em-aberto.md` (máx. 8 itens, cada um com recomendação). Itens resolvidos migram para o documento temático com "Decidido em AAAA-MM-DD".
- Mudanças de contrato da API = nova versão (`/api/v2`) ou campo aditivo; nunca remover campo sem deprecation.
- Diagramas em ASCII dentro do markdown — sem ferramentas externas.

## 🚨 Ambiente de execução (OpenCode / Antigravity)

Você está rodando **no computador do usuário**, com acesso ao filesystem e ao shell da pasta do projeto. Portanto:

- Não peça para o usuário criar/mover/apagar arquivos manualmente — execute você.
- Só relate impedimento se for erro real de permissão, colando a mensagem exata e dizendo qual permissão liberar.
- Trabalhe **somente** dentro da pasta raiz do projeto.
- Se um comando falhar: leia o erro, corrija, tente de novo.

### Regras de segurança para operar no PC

1. **Apagar:** liste primeiro o que será apagado (`git status`/`ls`), depois apague. Nunca `rm -rf` fora da pasta do projeto, nem com caminho montado por variável sem verificar.
2. **Checkpoint antes de mudanças grandes:** `git init` (se faltar) e `git add -A && git commit -m "checkpoint: antes de <ação>"`.
3. **Nunca** `git push --force`, **nunca** altere configurações globais do sistema, **não instale nada globalmente sem avisar**.
4. **Nunca leia, exiba ou grave** senhas/tokens/chaves reais. Apenas placeholders em `.env.example`. `.env*` no `.gitignore` — confira antes do primeiro commit.
5. **Ao terminar**, mostre resumo curto: arquivos criados/alterados/apagados + comandos executados.

## 🎨 Fase visual (UI)

- Branch: `feat/ui-visual` (criada de `feat/ui-hub`; não mergeada). Telas em `components/hub/` e rotas `/a/[ws]/...`.
- Dados 100% fictícios em `lib/mock/` — nenhum cliente/valor real.
- Espelho público de demonstração: `/demo/...` **somente** com `NEXT_PUBLIC_DEMO_UI=1` (escopo Preview na Vercel; nunca Production). Sem a flag, o layout de `/demo` responde 404.
- Capturas de comparação: `docs/referencia/comparacao/` (01–11), script `scripts/capture-visual.mjs` (Playwright, viewport 1915×1030 + 1366×768 + 390px).
- Referências reais ficam em `imagens/` (gitignored, LGPD) — nunca commitar.
- “Fase visual concluída” em `docs/progresso-ui.md`; próximos passos = ligar Supabase por tela (Visão geral → Contas → Relatórios).

## 🗺️ Roadmap

`docs/roadmap-fase-1.md` — ordem de implementação da Fase 1 com critério de pronto. Fases futuras (cardápio público/pedidos, Meta Ads, relatórios, WhatsApp) ficam fora do escopo atual.

## 🚀 Deploy (Vercel)

Fluxo padrão (nunca pular o preview):

1. **Branch de release** (`release/orvia-vX.Y`) aponta para a branch mais avançada (`feat/*`).
2. **Preview**: `git push -u origin release/orvia-vX.Y` → a Vercel cria um deployment de preview (protegido por login Vercel, por design).
   - Verifique: `/login` renderiza a marca (título "Orvia — ..."), build `Ready`.
   - Descobrir URL/status: `npx vercel ls orvia` · detalhes: `npx vercel inspect <url> --wait`.
3. **Produção** (somente com preview aprovado): `git switch master && git merge --no-ff release/orvia-vX.Y -m "merge: release → master" && git push origin master` → a Vercel gera o deployment de produção (aliás `https://orvia-gestao.vercel.app`).
4. **Verificação pós-deploy**: `GET /login` → 200 com título "Orvia"; logo/favicon em `/brand/*` e `/icon.svg`; `/dashboard` → 307/redirect para `/login` sem sessão.

### Rollback

- Deployment de produção anterior (registrado em 04/11/2026): `dpl_9Fj52z3X72xZfQ5pFsBLUi5WFm4c` (alias `https://nextjs-cardapio-jxjyn9mto-gabrieldluccaoliveira-4662s-projects.vercel.app`).
- Para reverter: `npx vercel rollback <url-do-deployment-anterior>` (ou promova o deployment anterior no painel da Vercel → Deployments → Promote). Depois reverta o `master` (`git revert`/`git switch master` e re-push) para manter o histórico de acordo.
- **NUNCA** `git push --force`, apagar deployments ou renomear o projeto/domínio sem decisão explícita.
- **Banco remoto**: 0001–0003 (schema Orvia + RLS + FK composta) aplicadas em produção (projeto AnjimBanco/zzdiefephohlyicgexkv) em 05/11/2026, após backup (`db dump --remote`, dump em disco local, fora do repo). **Migrations futuras**: apenas via `supabase db push` com backup prévio + janela; desenvolvimento primeiro (`supabase db reset`).

### Variáveis de ambiente na Vercel (nomes, nunca valores)

Usadas pelo app (Preview e Production têm cópia, configuradas em 04/11/2026):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (públicas, client-side)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret, **somente servidor**: server actions/admin)
- `SUPABASE_JWKS_URL` (secret, hoje Production e Preview; reservada para auth futura)
- `META_ACCESS_TOKEN` (secret, **somente servidor**: token de Usuário do Sistema da Meta) e `META_BUSINESS_ID` (id do portfólio) — sincronização de Contas de anúncio (`lib/meta/graph.ts`, 0007)
- `CRON_SECRET` (secret, gerado aleatório em 2026-11-09) — protege `/api/cron/keepalive` (cron diário em `vercel.json` que impede a pausa do Supabase gratuito por 7 dias sem uso)
- `ANTHROPIC_API_KEY` (opcional) — sem ela, `/api/v1/analysis` usa o modo gratuito (regras + pesquisa pública)
- `CARDAPIOWEB_EXTENSION_IDS` (opcional) — id(s) do Chrome da extensão Cardápio Web (ver `docs/extensoes.md` §13 e `docs/integracao-extensoes-hub.md`)

Regras:
- `NEXT_PUBLIC_*` é embutida no build — se mudar, **refaça o build** (push de novo ou redeploy).
- Valores do tipo `Secret` não são revelados pela CLI/painel (mascarados); para espelhar de Production para Preview, re-cadastre-os no painel (Settings → Environment Variables) com escopo Preview — nunca cole valores no chat/commit.
- `.env.local` da máquina fica só com placeholders; valores reais vivem na Vercel.
- **Endereço público (decidido em 11/11/2026): `https://orviahub.vercel.app`** — não há domínio próprio (`orviahub.com.br` nunca foi registrado; a decisão de 08/11 foi revertida). `brand.baseUrl` em `packages/brand`. As extensões continuam usando `orvia-gestao.vercel.app` (`brand.extensionHubUrl`, fixo em `host_permissions`); os dois aliases servem o mesmo deployment de produção — não remover nenhum.
- Projeto Vercel: **`orvia`** (público em `https://orvia-gestao.vercel.app`; `orvia.vercel.app` já estava ocupado; alias legado `nextjs-cardapio.vercel.app` segue ativo) — renomeado em 04/11/2026 por decisão do usuário.

## 📖 Sumário da documentação

- `docs/api.md` — API REST `/api/v1` (endpoints, escopos, If-Match, paginação)
- `docs/openapi.yaml` — Contrato OpenAPI 3.1 (esqueleto → fonte de `packages/api-types`)
- `docs/extensoes.md` — Extensões: registro, chaves, escopos, rotação, CORS, manifest.json
- `docs/webhooks.md` — Eventos, HMAC-SHA256, backoff, SSRF
- `docs/fotos-e-historico.md` — Pipeline de imagens, `menu_image_history`, restore, retenção
- `docs/roadmap-fase-1.md` — Roadmap com critérios de pronto
- `docs/decisoes-em-aberto.md` — Riscos e decisões pendentes (máx. 8)
- `docs/rebrand-inventario.md` — Inventário e decisões do rebrand para Orvia
- `docs/db-validacao.md` — Validação local do schema/RLS: o que passou, falhas e correções
- `docs/integracao-extensoes-hub.md` — Kit para as extensões (iFood/Cardápio Web): prompt, contrato e cliente pronto
