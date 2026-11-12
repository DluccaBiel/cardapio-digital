# Undercut

**Gestão que conecta** — Hub de gestão para assessorias: clientes, cardápio, relatórios e extensões de navegador.

Tema escuro com destaque azul `#3D8EFF`, tabelas densas, rotas `/a/{workspace}/...`.

> Status: Fase 1 (arquitetura) concluída. A aplicação Next.js atual vive na raiz do repositório; a migração para `apps/hub/` está no roadmap.

## Stack

Next.js 14 (App Router) · TypeScript · Supabase (Postgres + RLS + Storage + Auth) · Vercel · npm workspaces (`packages/*`) · Marca e tokens centralizados em [`packages/brand`](packages/brand/README.md).

## Quickstart

```bash
cp .env.example .env.local   # preencha com suas credenciais (nunca commite)
npm install
npm run dev                  # http://localhost:3000
npm run typecheck            # tsc --noEmit
npm run build                # build de produção
```

Banco (Supabase, com CLI instalada):

```bash
supabase db reset            # aplica 0001_init.sql + 0002_rls.sql do zero (local)
# Backup ANTES de qualquer migração em produção — ver AGENTS.md
```

## Estrutura

```text
├── app/, lib/, actions/     # App Next.js (legado, na raiz; migração para apps/hub no roadmap)
├── apps/extensions/         # Extensões Chrome MV3
├── packages/api-types/      # Tipos da API (a partir de docs/openapi.yaml)
├── packages/brand/          # Nome, cores, logos — fonte única da marca
├── supabase/migrations/     # 0001_init.sql, 0002_rls.sql
├── docs/                    # Arquitetura: api, openapi, extensões, webhooks, fotos, roadmap
└── AGENTS.md                # Regras para agentes/sessões neste repositório
```

## Documentação

- [AGENTS.md](AGENTS.md) — stack, comandos, regras de segurança, ambiente de execução
- [docs/api.md](docs/api.md) · [docs/openapi.yaml](docs/openapi.yaml) — API REST `/api/v1`
- [docs/extensoes.md](docs/extensoes.md) · [docs/webhooks.md](docs/webhooks.md) — extensões e webhooks (HMAC)
- [docs/fotos-e-historico.md](docs/fotos-e-historico.md) — pipeline de imagens
- [docs/roadmap-fase-1.md](docs/roadmap-fase-1.md) — ordem de implementação da Fase 1
- [docs/decisoes-em-aberto.md](docs/decisoes-em-aberto.md) — riscos e decisões pendentes
- [docs/rebrand-inventario.md](docs/rebrand-inventario.md) — inventário e decisões do rebrand (Cardápio Web Hub → Undercut)

## Licença

Proprietária — © Undercut. Uso interno da assessoria. Marca **não** registrada (ver `docs/rebrand-inventario.md`).
