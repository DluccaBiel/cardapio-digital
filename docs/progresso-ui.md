# Orvia — Progresso da UI (Hub)

> Regra de retomada: leia `AGENTS.md` e este arquivo. `Continue do Marco N` retoma exatamente daí.
> Atualizado por sessão de trabalho. Cada marco termina com: typecheck + build + testes de banco + commit + push da branch `feat/ui-hub` + URL do preview.

## Retomada rápida
- Branch: `feat/ui-hub` (criada de `master` em 05/11/2026). NÃO mergear em master e NÃO deployar produção — o usuário aprova.
- Ambiente de execução: OpenCode nesta pasta; `npm run dev|build|typecheck`, `npx supabase` (CLI local, link ao projeto novo).
- **Banco novo e exclusivo do Orvia:** projeto `admpython` ref `xazfnddnwggrbomjwzlg` (us-east-2, ACTIVE_HEALTHY). Nunca usar `zzdiefephohlyicgexkv` (AnjimBanco) nem outros.
- Projeto anterior teve a fase 1 aplicada (0001–0003). Este projeto novo tem 0001–0003 aplicados (em 05/11/2026). **Remote estava vazio** (REST 404 em `clients`; dump `pre-push-new-orvia-20261105.sql` em Local Temp, fora do repo).
- `.env.local` (fora do git) aponta para o projeto novo: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`.

## Marco 0 — Fundação (concluído em 05/11/2026)
Feito:
- Tailwind (tokens Orvia, preflight desligado p/ conviver com globals.css) + `@tanstack/react-table`, `@dnd-kit/*`, `zod` (avisado à parte, conforme pedido) + `@types/react-dom` (18).
- Shell autenticado: layout `/a/[ws]` com sidebar recolhível (desktop) + drawer (mobile), header com wordmark + workspace switcher + "Atualizado agora" + Sincronizar + busca "Buscar cliente… Ctrl K" + selo de papel + avatar.
- Paleta Ctrl K (`Ctrl`/`Cmd`+K), ações de navegação + atalhos (Novo cliente, Exportar CSV).
- Rotas: `/a/[ws]/{visao-geral,agenda,contas,relatorios,cardapio,extensoes}` com estados vazios estilizados; `/a/[ws]` → `visao-geral`; `/` → primeiro workspace ou `/onboarding`; login/cadastro mantidos com a marca.
- Middleware: protege `/a/*` e `/onboarding` (redirect 307 → /login).
- Onboarding: cria o primeiro workspace (service role faz bootstrap ws+owner, RLS não permitiria por outro caminho).
- Tipos TS gerados de `remote` (`packages/api-types/database.types.ts`).

Testado:
- `npm run typecheck` ✅ · `npm run build` ✅ · `npm run start` local: `/login` 200; `/` e `/a/…` → 307 → `/login` ✅.
- Banco novo: 0001/0002/0003 aplicados + RLS verificada (REST → 200 `[]` sem sessão) ✅.

Pendências / notas:
- **PREVIEW na Vercel aponta para o projeto NOVO** (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY + SUPABASE_URL / SERVICE_ROLE_KEY / JWKS_URL atualizados no escopo Preview em 05/11/2026). **PRODUCTION continua apontando para o projeto antigo (AnjimBanco)** — não alterado sem aprovação.
- Preview de `feat/ui-hub` na Vercel continuará atrás da autenticação Vercel (Deployment Protection) — verificação visual pelo usuário.
- Auth (Site URL + redirects) no painel Supabase: **pendente** — o usuário precisa incluir `https://orvia-gestao.vercel.app` e a URL de preview do PR/branch em Authentication → URL Configuration (relatar por marco).
- O usuário deve decidir se as envs de PRODUCTION passam ao projeto novo antes do merge final (Marco 6).

## Marco 1 — Banco novo conectado (em andamento)
00: link, dump pré-push, push 0001–0003 (✅), REST vazio ✅, envs preview ✅, tipos gerados ✅.
Falta: Auth Site URL/redirects no painel (usuário) · conferir o preview após push do Marco 0 · e, por marco subsequente, migrations novas + testes.

## Plano de marcos
- Marco 2 — Visão geral + Clientes (migration 0005 e testes; KPIs; filtros; CSV; seed).
- Marco 3 — Contas de anúncio + Relatórios (dados manuais; migration 0004 e testes).
- Marco 4 — Cardápio (CRUD + fotos + histórico; CSV antiga movida para cá).
- Marco 5 — Extensões + API /api/v1 (chaves, escopos, If-Match; smoke HTTP contra o projeto novo).
- Marco 6 — Fechamento (revisão vs. imagens; acessibilidade; responsivo; docs; checklist).

## Decisões
- Fontes únicas de marca mantidas (`packages/brand`); azul luminoso `#3D8EFF`.
- Tokens duplicados no `tailwind.config.ts` (limitação de import TS) — manter sincronizados com `brand.config.ts`.
- Seed/demo sempre fictício e marcado como `(Demo)`.
- Sem push de produção; merges e deploy só com aprovação do usuário.

## Retomada
- Último commit: Marco 0 (fundação) — ver `git log` desta branch.
- Preview (último): ver saída do push; verificar em `npx vercel ls orvia`.
- **Continue do Marco 1** (Auth no painel + marcos restantes em ordem).
