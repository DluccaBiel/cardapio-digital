# Inventário de Rebrand — Cardápio Web Hub → **Orvia**

> Gerado por busca exaustiva (case/acento-insensitive) em todo o repositório,
> excluindo `.git/`, `node_modules/`, `.next/`, `.vercel/`, `package-lock.json` e `.env.*`.
> Classificação: **MARCA** (trocar) · **FUNCIONAL** (manter — integração/terceiros/substantivo comum) · **NÃO TOCAR** (regra/migrations/segredos/estrutura).
> Decisão registrada ao lado de cada item.

## Mapa dos nomes históricos encontrados

| Termo buscado | Ocorrências | Onde |
|---|---|---|
| `FlyTo` / `Fly To` / `assessoriaflyto` (e variações de case) | **0** | nenhum arquivo |
| `Cardápio Web Hub` / `CARDÁPIO WEB HUB` | 6 | `.env.example`, `AGENTS.md`, `docs/api.md`, `docs/openapi.yaml` (×2), `supabase/migrations/0001_init.sql` |
| `Painel do Gestor` | 2 | `AGENTS.md`, `supabase/migrations/0001_init.sql` |
| `cardapio-web-hub` | 0 | — |
| `cardapio` / `Cardápio` (substantivo ou marca) | ~40 | código `app/`, `globals.css`, docs, migrations |
| `cardapio-next` (nome do pacote raiz) | 1 | `package.json` (+ `package-lock.json`, regenerado pelo npm) |
| nome público do app | "Cardápio Digital" | `app/layout.tsx`, `app/login/page.tsx`, `app/cadastro/page.tsx` |
| `#22c55e` (verde de tag/neon citado em docs) | 3 | `0001_init.sql` (default de tag, NÃO TOCAR), `docs/openapi.yaml`, `docs/roadmap-fase-1.md` |
| `#22ff88` / `#a3ff12` / "verde neon" | 2 | `docs/roadmap-fase-1.md`, `AGENTS.md` (tema documentado) |
| `cardapio-hub-webhooks/1.0` (User-Agent de exemplo) | 1 | `docs/webhooks.md` |
| `Cardápio Hub - Troca de Fotos` (nome de exemplo de extensão) | 1 | `docs/extensoes.md` |
| `"x-flyto"`, `"flyto_"`, `flyto` (prefixos de API/localStorage/webhook) | **0** | nenhum — **nada a migrar** |

## Tabela de ocorrências e decisões

| Arquivo | Linha | Trecho | Classificação | Decisão |
|---|---|---|---|---|
| `package.json` | 2 | `"name": "cardapio-next"` | MARCA | Renomear para `@orvia/hub` (app continua na raiz — ver nota de estrutura abaixo) |
| `package.json` | — | workspaces | MARCA | Adicionar `workspaces: ["packages/*", "apps/*"]`; `@orvia/brand` e `@orvia/api-types` como membros |
| `app/layout.tsx` | 8–9 | `title: 'Cardápio Digital'`, `description: '...'` | MARCA | Metadata via `@orvia/brand` (title, description, OG, favicon) |
| `app/login/page.tsx` | 33 | `<div class="brand">… Cardápio Digital</div>` | MARCA | Logo `orvia-mark` + palavra "Orvia" via `@orvia/brand` |
| `app/cadastro/page.tsx` | 40 | `<div class="brand">… Cardápio Digital</div>` | MARCA | Idem |
| `app/globals.css` | várias | destaque **vermelho** `#b91c1c` (não verde) | MARCA (cor de marca) | Paleta azul Orvia (ver Etapa 3); verde só p/ status "ok" |
| `app/page.tsx` | — | `redirect('/login')` | NÃO TOCAR | Sem marca |
| `app/relatorios/page.tsx` | 24 | `defaultValue="Otimização de Cardápio"` | FUNCIONAL | Conteúdo de negócio (tema do relatório), manter |
| `app/cliente/relatorio/[token]/page.tsx` | 24,36 | "Relatório de Otimização do Cardápio" | FUNCIONAL | Idem |
| `.env.example` | 2 | `# Cardápio Web Hub - variáveis...` | MARCA | Comentário → "Orvia" (nenhum nome de variável muda — zero impacto em `.env.local`/Vercel) |
| `AGENTS.md` | 1 | `# AGENTS.md — Cardápio Web Hub / Painel do Gestor (Fase 1)` | MARCA | `# AGENTS.md — Orvia (Fase 1)` |
| `AGENTS.md` | 7 | "destaque verde neon" | MARCA (cor) | "destaque azul Orvia (#2F6BFF)" |
| `docs/api.md` | 1 | título `# API pública /api/v1 — Cardápio Web Hub` | MARCA | `# API pública /api/v1 — Orvia` |
| `docs/openapi.yaml` | 3 | comentário `# Contrato OpenAPI 3.1 — Cardápio Web Hub (Fase 1)` | MARCA | → Orvia |
| `docs/openapi.yaml` | 10 | `title: Cardápio Web Hub - API` | MARCA | `title: Orvia — API` |
| `docs/openapi.yaml` | 17 | `contact.name: Assessoria — Plataforma` | FUNCIONAL | Genérico; manter |
| `docs/openapi.yaml` | 191 | `default: '#22c55e'` (cor default de tag) | FUNCIONAL | Default de conteúdo (tag), não cor de interface; manter |
| `docs/roadmap-fase-1.md` | 18–19 | "tema escuro + neon", `#22ff88`/`#a3ff12` | MARCA (cor) | Atualizar para paleta azul Orvia |
| `docs/webhooks.md` | 52 | `User-Agent: cardapio-hub-webhooks/1.0` | MARCA (identificador de doc) | `orvia-webhooks/1.0` — exemplo ainda não implementado; zero consumidores, sem impacto |
| `docs/extensoes.md` | 82 | `"name": "Cardápio Hub — Troca de Fotos"` (exemplo de esqueleto) | MARCA | `"Orvia — Troca de Fotos"` |
| `docs/fotos-e-historico.md` | 1 | título `# Fotos e histórico de imagens — Cardápio` | FUNCIONAL | "Cardápio" = substantivo (módulo), manter |
| `docs/decisoes-em-aberto.md` | 6 | "fotos de cardápio em WebP" | FUNCIONAL | Substantivo, manter |
| `docs/api.md`, `docs/webhooks.md`, `docs/extensoes.md`, `docs/roadmap-fase-1.md`, `docs/fotos-e-historico.md` | várias | "cardápio" como módulo/domínio (categorias, itens, pedidos, público/pedidos) | FUNCIONAL | Manter |
| `supabase/migrations/0001_init.sql` | 2 | comentário de cabeçalho `… Cardápio Web Hub / Painel do Gestor` | NÃO TOCAR | Migration existente; prompt proíbe alterá-la; rótulo cosmético |
| `supabase/migrations/0001_init.sql` | 107 | `default '#22c55e'` (cor de tag) | NÃO TOCAR | Schema existente; não alterar migrations |
| `supabase/migrations/0001_init.sql` / `0002_rls.sql` | várias | "cardápio" em comentários (`menu_*`, RLS) | NÃO TOCAR | Comentários de schema existente |
| `docs/roadmap-fase-1.md`, `AGENTS.md` | — | "Painel do Gestor" | MARCA | Ocorrem apenas nas linhas 1/104 já listadas; demais usos funcionais |
| `actions/*.ts`, `lib/*.ts`, `app/**/*.tsx` | várias | nenhuma ocorrência de marca além das listadas | — | Verificado |
| `apps/extensions/*` | — | **não existem extensões no repo** (só `.gitkeep`) | n/d | Nada a renomear; ícones PNG ficarão em `packages/brand/logo/` prontos para copiar |
| `apps/hub`, `packages/api-types` | — | vazios (`.gitkeep`) | MARCA (nome) | Ganharão `package.json` `@orvia/hub` n/d; `@orvia/api-types` |
| `vercel.json`, `next.config.js`, `tsconfig.json`, `middleware.ts` | — | nenhuma marca | NÃO TOCAR | Manter |

## Notas estruturais

1. **App na raiz, monorepo vazio**: o app Next.js vive na raiz do repositório (`app/`, `lib/`, `actions/`); `apps/hub` está reservado-vazio. Mover os arquivos quebraria o projeto Vercel existente (root build + `vercel.json`) **e está fora de escopo do rebrand**. Decisão: a raiz passa a se chamar `@orvia/hub` (`private: true`); `apps/*` e `packages/*` entram como npm workspaces; quando o app for migrado para `apps/hub/` (roadmap), o nome `@orvia/hub` acompanha.
2. **Tailwind ausente**: o app usa CSS vanilla (`app/globals.css`). As tokens Tailwind do Orvia entram via `brand.config.ts` + variáveis CSS `:root` (utilitários prontos para quando o shell com Tailwind existir); nenhuma dependência nova de UI será adicionada neste rebrand.
3. **Nenhum prefixo técnico de marca existe** (`flyto_`, `X-FlyTo-*`, localStorage, eventos): nada a migrar; novos identificadores nascem `orvia-*` / `orvia_`.
4. **`.env.local` e segredos**: não lidos, não alterados, continuam ignorados.
5. **Nenhum nome de variável de ambiente muda** nesta etapa (impacto zero em Vercel/local).
6. **Migrations NÃO são alteradas** (nem a linha de cabeçalho de `0001_init.sql`); se um rótulo de comentário de banco for desejado no futuro, será nova migration `0003_*`.
7. **"Orvia" não foi checado** quanto a marca registrada (INPI) nem disponibilidade de domínio — vide relatório final.
