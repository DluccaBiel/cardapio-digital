# Roadmap — Fase 1 (núcleo + clientes + cardápio + API/extensões)

Ordem de implementação incremental. Cada passo tem **critério de pronto**. Não pule etapas; cada uma é testável isoladamente. Backup do banco antes de qualquer migração (local ou produção).

## Passo 0 — Fundamentos do monorepo
- pnpm/npm workspaces (`apps/hub`, `apps/extensions/*`, `packages/api-types`), `turbo.json`, `tsconfig` base, ESLint + Prettier, Tailwind no hub.
- **Pronto quando:** `npm run dev` sobe o hub vazio em `/a/teste` e `npm run lint` passa no CI.

## Passo 1 — Supabase + migrations + RLS
- Criar projeto Supabase (free tier), aplicar `0001_init.sql` e `0002_rls.sql` (local via `supabase db reset`; produção após backup).
- Seed de desenvolvimento: 1 workspace, 1 owner, 2 clientes, 1 cardápio com itens/grupos/fotos.
- **Pronto quando:** todas as tabelas com `rowsecurity = true` (`select tablename from pg_tables where schemaname='public' and not rowsecurity` → 0 linhas); owner do workspace A não lê dados do workspace B (teste automatizado); rollback ensaiado em ambiente de teste.

## Passo 2 — Auth + onboarding de workspace
- Supabase Auth (e-mail/senha + magic link), criação de workspace no primeiro login (`/a/{slug}/onboarding`), convite de membros por e-mail com papel.
- **Pronto quando:** criar workspace → convidar coordenador/editor/visualizador → cada papel enxerga exatamente o que a RLS permite (matriz testada); usuário de fora recebe 404/403.

## Passo 3 — Shell do painel (tema escuro + azul Orvia)
- Layout `/a/{workspace}/(dashboard)`: sidebar, topbar, tabelas densas, tokens de cor (bg `#0B1220`, primária `#2F6BFF` — ver `packages/brand/brand.config.ts`), fonte Inter/IBM Plex Mono para números.
- **Pronto quando:** navegação completa com dados seed; dark theme sem flash; Lighthouse a11y ≥ 90 nas telas núcleo.

## Passo 4 — Módulo Clientes (Visão geral)
- Tabela densa: situação, tags, gasto do mês, saldo, status de entrega; filtros por status/tag/busca; ordenação; export CSV.
- CRUD de clientes e tags; ficha do cliente com contas de anúncio (mochila manual por enquanto).
- **Pronto quando:** CRUD completo com `If-Match` nos updates (409 em conflito simulado); filtros e paginação funcionando com ≥ 200 clientes seed; `audit_log` registra escritas.

## Passo 5 — Cardápio: categorias + itens
- CRUD de `menu_categories` e `menu_items` (inline edit na tabela, status `active/inactive/out_of_stock`, `sort_order` por drag ou setas, busca/filtros).
- **Pronto quando:** criar/reordenar/inativar itens; preço com 2 casas validado; conflito concorrente retorna 409 com payload `current`.

## Passo 6 — Complementos: grupos + subitens + vínculos
- CRUD de `menu_addon_groups` (min/max qty), `menu_subitems`, vínculo N:N item↔grupo com ordenação.
- **Pronto quando:** montar "X-Burger" com grupo "Adicionais" (min 0 / max 3) e 5 subitens; desvincular grupo remove o vínculo sem apagar o grupo; validação `min_qty ≤ max_qty`.

## Passo 7 — Imagens: upload, versão e histórico
- Pipeline completo de `docs/fotos-e-historico.md`: upload multipart → validação magic bytes → WebP q82 + EXIF strip → SHA-256 → `menu_images` + `menu_image_history` → signed URL.
- UI: trocar foto no item e no subitem, ver histórico, restaurar (`restore`), remover.
- Job de retenção (90 dias) em `pg_cron` ou Vercel Cron.
- **Pronto quando:** 3 trocas seguidas geram 3 versões; restore da v1 volta a ser a corrente com nova versão; URL antiga expirada não quebra o restore (arquivo íntegro); job de expurgo ensaiado em staging.

## Passo 8 — API `/api/v1` para extensões
- Route Handlers para todos os endpoints de `docs/api.md` (clients, tags, menu, imagens, webhooks, api-keys). Middleware único: auth por chave → hash → rate limit → escopo → workspace scoping → Zod → handler → audit_log.
- Erros com envelope padronizado; ETag/If-Match; paginação; `Idempotency-Key`.
- CORS: allowlist `chrome-extension://<id>` + preflight 204.
- **Pronto quando:** suíte de testes de contrato (supertest contra staging) cobre 100% dos endpoints de leitura e escrita críticos; chave sem escopo → 403; If-Match divergente → 409; rate limit → 429; `audit_log` com ator `api_key`.

## Passo 9 — Extensão "Troca de Fotos" migrada para a API do hub
- Trocar `API privada do terceiro` → `X-API-Key` + endpoints do hub; conferência antes de aplicar via `If-Match` (409 ⇒ marcar `conflict`); backup local vira lista de `image_id` + `version`; "desfazer" chama `restore` por item; pausa entre envios 300–500 ms.
- `manifest.json`: `host_permissions` só do hub; `permissions: ["storage"]`.
- **Pronto quando:** trocar 20 fotos em lote em cardápio real de teste; 1 item editado manualmente durante o lote aparece como `conflict` e não é sobrescrito; "desfazer tudo" restaura todas as fotos anteriores; `last_seen_at` atualizado no handshake.

## Passo 10 — Webhooks de saída
- Tabela `webhooks`/`webhook_deliveries`, worker com backoff (`docs/webhooks.md`), HMAC, SSRF guard, auto-desativação após 20 falhas, tela de entregas no painel + retry manual + webhook de teste.
- **Pronto quando:** webhook de teste recebe `menu.image.replaced` assinado e valida HMAC; receptor offline por 8 tentativas → `gave_up` e `is_active=false`; retry manual reentrega.

## Passo 11 — Acabamento e go-live
- `docs/openapi.yaml` ↔ `packages/api-types` sincronizados (`npm run gen:types`), README raiz, Sentry (free) ou log de erros, backup agendado do Supabase, `robots.txt`, domínio Vercel.
- **Pronto quando:** deploy em produção; extensão publicada/instalada; 1ª semana sem erro crítico; backup restaurado com sucesso em projeto de staging (ensaio de DR).

## Fora da Fase 1 (não implementar agora)
Cardápio público e pedidos, Meta Ads sync, relatórios semanais automáticos, WhatsApp, multi-idioma, rate limit distribuído (Redis/Upstash), iOS/Android, SDK público.
