# AGENTS.md - Cardápio Web Hub (Fase 1)

## 📋 Stack
- **Frontend:** Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend:** Next.js Server Actions + Supabase Edge Functions (opcional)
- **Banco:** Supabase (PostgreSQL 15+) + RLS
- **Armazenamento de arquivos:** Supabase Storage (bucket público `produto-imagens`)
- **Autenticação:** Supabase Auth
- **Hospedagem:** Vercel (gratuito) + Supabase (plano gratuito)
- **Monorepo:** `apps/hub`, `apps/extensions/*`, `packages/api-types`

## 📁 Estrutura de pastas
```
cardapio-digital/
├── apps/hub/                 # Aplicação web principal (Next.js)
├── apps/extensions/          # Extensões de navegador (Chrome MV3)
├── packages/api-types/       # Tipos TypeScript compartilhados (OpenAPI)
├── supabase/migrations/      # Migrações SQL
├── storage/                  # (não versionar) bucket local se houver
└── docs/                     # Documentação de arquitetura
```

## 🧩 Comandos
```bash
# Instalar dependências
npm install

# Rodar em desenvolvimento (Next.js)
npm run dev

# Build de produção
npm run build

# Criar migração Supabase
supabase migration new nome_da_migracao

# Aplicar migrações locais
supabase db start
supabase db reset

# Lint
npm run lint

# Testes
npm test
```

## 🔐 Regras de segurança (obrigatório)
1. **Nunca** commite `.env`. Use apenas `.env.example`.
2. `SUPABASE_SERVICE_ROLE_KEY` só pode ser usada no **servidor** (Server Actions/Edge Functions). Nunca no frontend.
3. **RLS ativo em todas as tabelas**. Nunca desative RLS por "conveniência".
4. Valide entrada em todas as entradas de API (Zod ou similar).
5. Sanitize saída para evitar XSS.
6. Chaves de API de extensões são armazenadas apenas com **hash** (bcrypt/argon2). Nunca exiba a chave completa depois da criação.
7. Backup do banco **antes** de qualquer migração em produção.

## 🗄️ Como criar migração
```bash
supabase migration new nome_da_migracao
# Edite o arquivo gerado em supabase/migrations/
supabase db reset
```

## 🧩 Como criar uma extensão de navegador
1. Crie a pasta em `apps/extensions/minha-extensao`.
2. Adicione `manifest.json` com `host_permissions` para `https://seu-projeto.supabase.co/*` e sua própria API.
3. Use `chrome.storage.local` para guardar a chave de API localmente (criptografada se possível).
4. Toda requisição à API do hub deve incluir header `X-API-KEY`.
5. Respeite CORS: o servidor deve permitir `Origin: chrome-extension://<seu-id>`.

## 📚 Documentação
- `docs/api.md` – Especificação da API REST
- `docs/openapi.yaml` – Contrato OpenAPI 3.1
- `docs/webhooks.md` – Eventos e assinatura HMAC
- `docs/extensoes.md` – Integração com extensões
- `docs/fotos-e-historico.md` – Política de imagens e histórico
- `docs/roadmap-fase-1.md` – Plano de implementação
- `docs/decisoes-em-aberto.md` – Riscos e decisões pendentes

## 🚨 Ambiente de execução (OpenCode / Antigravity)
- Este arquivo aplica-se a qualquer sessão que trabalhe neste repositório.
- Antes de operações destrutivas, sempre faça: `git add -A && git commit -m "checkpoint: antes de <ação>"`.
- Nunca rode `rm -rf` fora da pasta do projeto.
- Nunca use `git push --force`.
- Nunca instale pacotes globalmente sem avisar.
