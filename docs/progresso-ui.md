# Undercut — Progresso da UI (Hub)

> Regra de retomada: leia `AGENTS.md` e este arquivo. `Continue do Marco N` retoma exatamente daí.
> Atualizado por sessão de trabalho. Cada marco termina com: typecheck + build + testes de banco + commit + push da branch `feat/ui-hub` + URL do preview.

## Retomada rápida
- Branch ativa da fase visual: `feat/ui-visual` (não mergeada, não deployada em produção). A branch de backend anterior é `feat/ui-hub` (checkpoint `548e9a9`).
- **Fase visual concluída** — ver seção própria abaixo; `NEXT_PUBLIC_DEMO_UI=1` no escopo Preview abre `/demo/*`.
- Ambiente de execução: OpenCode nesta pasta; `npm run dev|build|typecheck`, `npx supabase` (CLI local, link ao projeto novo).
- **Banco novo e exclusivo do Undercut:** projeto `admpython` ref `xazfnddnwggrbomjwzlg` (us-east-2, ACTIVE_HEALTHY). Nunca usar `zzdiefephohlyicgexkv` (AnjimBanco) nem outros.
- Projeto anterior teve a fase 1 aplicada (0001–0003). Este projeto novo tem 0001–0003 aplicados (em 05/11/2026). **Remote estava vazio** (REST 404 em `clients`; dump `pre-push-new-orvia-20261105.sql` em Local Temp, fora do repo).
- `.env.local` (fora do git) aponta para o projeto novo: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS_URL`.

## Marco 0 — Fundação ✅ (05/11/2026)
Preview: https://orvia-49q2mfl5d-gabrieldluccaoliveira-4662s-projects.vercel.app (dpl_5bpvheVZ58U5BHaq3Rg8SpZv3ChU)
Commit: `2b8b76b` (+ `d0ad092`). Feito:
- Tailwind (tokens Undercut, preflight desligado p/ conviver com globals.css) + `@tanstack/react-table`, `@dnd-kit/*`, `zod` (avisado à parte, conforme pedido) + `@types/react-dom` (18).
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

## Fase visual — concluída ✅ (05/11/2026)

Branch: `feat/ui-visual` (criada do checkpoint `548e9a9` de `feat/ui-hub`; o WIP do Marco 2 fica preservado no histórico da outra branch).
Preview para aprovação: https://orvia-git-feat-ui-visual-gabrieldluccaoliveira-4662s-projects.vercel.app (deployment `dpl_...` — alias da branch; proteção de login Vercel).
Env necessária no escopo **Preview**: `NEXT_PUBLIC_DEMO_UI=1` (adicionada em 05/11/2026). Production permanece sem a flag: `/demo` responde 404.

O que foi feito (somente visual, dados fictícios, sem backend novo):
- Shell compartilhado em `components/hub/` (`HubShell`, `Header` 80px, `Sidebar` 280px recolhível + drawer, `CommandPalette` Ctrl K, `ui.tsx`).
- **Visão geral**: KPIs, navegação de mês, atalhos de período, chips de situação, filtros, colunas visíveis/reordenáveis, ordenação, exportação CSV (local), edição inline de situação/entrega/editor, modais de novo cliente/tag/Pix/links, tabela com cabeçalho e primeira coluna fixos + rolagem horizontal sincronizada.
- **Contas de Anúncio**: abas com contagem, busca, tabela, toggles de acompanhamento, modais de vínculo/detalhe/ações, botão “Buscar contas da BM” desabilitado (fase futura).
- **Gerador de Relatórios**: abas Gerador/Histórico, cliente + período + blocos + mensagem WhatsApp, ações copiar/WhatsApp/salvar/enviado e card 4:5 de prévia.
- **Agenda, Cardápio e Extensões**: placeholders “Em construção nesta fase”.
- Rotas reais `/a/[ws]/...` continuam protegidas pelo middleware; espelho público `/demo/...` atrás de `NEXT_PUBLIC_DEMO_UI=1` (só Preview).
- Camada de dados fictícios em `lib/mock/` (`getClients`, `getAdAccounts`, `getReportDraft`) para troca futura por Supabase.
- Onboarding: o campo “Identificador (URL)” aceita **qualquer link ou texto**; `lib/slug.ts` normaliza (ex.: `https://www.alpha.com.br/gestao` → `alpha-com-br-gestao`) no cliente (prévia do endereço) e no servidor, mantendo a constraint `^[a-z0-9][a-z0-9-]{1,62}$` e a rota `/a/{slug}`.
- Capturas de comparação em `docs/referencia/comparacao/` (01–11), incluindo 1915×1030, 1366×768, 390px e menu mobile. Script: `scripts/capture-visual.mjs`.
- Três rodadas de comparação com as imagens de referência; correções de densidade, colunas, sticky, responsivo e tipografia do card.
- `npm run typecheck` ✅ · `npm run build` ✅.

Divergências conscientes (visual-only):
- Verdes da referência viraram azul Undercut; verde só em status ok/ativo/online.
- Métricas do relatório são fictícias e propositalmente diferentes das imagens (R$ 2.480,15; 21.936; 26 compras; ROAS 5,77x etc.).
- Coluna fixa pode exibir fragmento de coluna vizinha em rolagem horizontal livre (comportamento nativo do sticky; referência “pula” colunas inteiras).
- Card do relatório sem as caixas internas com borda da referência; tipografia e proporção 4:5 mantidas.
- Agenda/Cardápio/Extensões ainda não têm tela real nesta fase.

Retomada da fase visual: **“Fase visual concluída”** — próxima etapa é ligar dados reais (Supabase) na ordem: Visão geral → Contas → Relatórios, mantendo o shell e o gate `/demo` para regressão visual.

## Marco 4 — Cardápio + API + extensão iFood ✅ local (06/11/2026)
Branch: `feat/cardapio` (a partir de `feat/ui-visual`). **Ainda não aplicado no banco remoto nem deployado.**
- Migration `0004_menu_combos_ifood.sql`: `menu_items.kind` (item/combo), `menu_combo_components` (RLS + FK composta + trigger de mesmo cliente), `ifood_*` + `ifood_synced_at` (fila de pendências), `clients.ifood_merchant_id` (trava de loja), RPC `mark_menu_items_ifood_synced`, extensão `orvia-ifood` no catálogo.
- Painel `/a/{ws}/cardapio` com dados reais: cliente, categorias (criar/renomear/ordenar/excluir), produtos (preço e status inline, modal completo com complementos), **combos** (montagem, desconto, preço sugerido terminando em ,90, economia, ativar/pausar), complementos (grupos/opções), **Sincronização iFood** (fila + "Já apliquei"). If-Match em toda edição (conflito → aviso + recarrega).
- Painel `/a/{ws}/extensoes`: gerar e revogar chaves (hash, exibida uma vez) e ver o status da extensão.
- API `/api/v1` (ver `docs/api.md` §7.1) e extensão reescrita em `apps/extensions/orvia-ifood` (ver o README dela).
- **Conectar com um clique** (Extensões → Conectar extensão / `/conectar-extensao`): o painel gera a chave e entrega direto à extensão (content script `hub-bridge`), sem copiar nem colar.
- Testes: RLS 70/0 · cross-link 20/0 · combos_ifood 16/0 · checks limpo · API 34/34 · painel E2E 9/9 · extensão vitest 25/25 + E2E Chromium 15/15 · `tsc` + `next build` ✅.
- Decisão do usuário (06/11/2026): usar o banco **antigo AnjimBanco (zzdiefephohlyicgexkv)**, que é o de Produção, para o uso diário. A 0004 é aplicada nele após backup.
- Nota de ambiente: o projeto fica no OneDrive, que às vezes trava arquivos de `.next` (`EBUSY`) durante o `next dev`. Se acontecer, reinicie o dev server.
- Para usar em produção: (1) backup + `supabase db push` da 0004 no projeto do ambiente, (2) preview → produção, (3) gerar a chave no painel e carregar a extensão.

## Marco 4.1 — Extensão 0.3: login, conectada, automático e IA ✅ (06/11/2026)
- Login com e-mail e senha do Undercut na extensão (`/api/v1/extension-auth/login`). Heartbeat a cada 2 minutos; o painel mostra "Conectada agora" e quem conectou.
- Aplicação automática no iFood por aprendizado. A extensão observa 1 edição no portal (`src/lib/learn.ts`) e depois executa com conferência e verificação (`src/lib/executor.ts`), com simulação e desfazer. Tokens ficam só na memória da aba.
- **Otimizar com IA** no Cardápio (`lib/ai/optimize.ts`, Claude `claude-opus-5-5`, saída estruturada e fallback de recusa). O servidor revalida IDs, o teto de variação de preço e os combos. Precisa de `ANTHROPIC_API_KEY` na Vercel.
- Testes: API 34/34 · painel 9/9 · extensão vitest 36/36 + E2E Chromium 29/29, contra o portal simulado com API protegida por token.

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
- Último commit de backend: Marco 0 (fundação) em `feat/ui-hub`.
- **Fase visual concluída** em `feat/ui-visual` (05/11/2026): shell + Visão geral + Contas + Relatórios + placeholders + `/demo`.
- Próximo passo sugerido: ligar Supabase por tela (Visão geral → Contas → Relatórios), preservando o shell e as capturas de regressão.

## Notas LGPD
- As imagens de referência (`imagens/`, fora do git) contêm nomes reais de clientes (D'Vivi, World Burguer…). Verificar se https://github.com/DluccaBiel/cardapio-digital é **público**; se for, o histórico da branch expõe esses nomes — considerar migração para repo privado ou squash no merge.
