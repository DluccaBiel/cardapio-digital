# Sistema de extensões — registro, chaves e API

> Como qualquer extensão Chrome MV3 criada por você lê e escreve dados no hub de forma segura. Backup do banco antes de qualquer migração em produção.

## 1. Visão geral

```text
Extensão (MV3)  ──HTTPS + X-API-Key──▶  /api/v1/*  ──▶  Supabase (RLS + service role no servidor)
                                          │
                                          └─ valida: hash da chave, expiração, revogação,
                                             rate limit por chave, escopo exigido, workspace_id
```

A extensão **nunca** fala diretamente com o PostgREST do Supabase nem com o bucket de Storage. Tudo passa pela API do hub, que aplica autorização e auditoria. A service role key fica **somente** no servidor (Vercel); ela nunca entra no `manifest.json`, no bundle da extensão nem no `chrome.storage`.

## 2. Registro (tabelas `extensions` e `extension_installs`)

- `extensions` — catálogo **global** de extensões da plataforma: `slug`, `name`, `description`, `homepage_url`. Criado apenas por você (service role); é o que aparece no painel em "Extensões disponíveis".
- `extension_installs` — vínculo extensão ↔ workspace: `api_key_id`, `installed_by`, `version` (informada no handshake), `status` (`active|suspended|uninstalled`), `last_seen_at`.
- `api_keys` — credenciais emitidas por workspace. **Só o hash vai para o banco** (`key_hash`, sha-256 com salt ou argon2id). O prefixo (`key_prefix`, ex.: `ck_live_9f3a2b1c`) é guardado para exibição/suporte.

Fluxo de emissão (painel, owner/coordenador):
1. Usuário escolhe a extensão e os escopos → `POST /api/v1/api-keys`.
2. Servidor gera `ck_live_<48 chars aleatórios>`, grava **somente o hash** + prefixo + escopos.
3. A chave em claro é devolvida **uma única vez** na resposta — a UI mostra um modal "copie agora" e nunca mais.

## 3. Escopos

| Escopo | Descrição |
|---|---|
| `clientes:ler` | Ler clientes, tags e contas de anúncio (GET) |
| `clientes:escrever` | Criar/editar/arquivar clientes e gerenciar tags |
| `catalogo:ler` | Ler categorias, itens, grupos, opções e imagens |
| `catalogo:escrever` | Escrever cardápio, trocar/remover/restaurar imagens |
| `webhooks:gerenciar` | Gerenciar webhooks do workspace |
| `extensoes:ler` | Ver catálogo e instalações (diagnóstico) |

Regras:
- Escopos são **mínimos e cumulativos**: uma extensão de troca de fotos precisa só de `catalogo:ler` + `catalogo:escrever`.
- Chaves criadas para uma extensão recebem por padrão apenas os escopos declarados no registro dela (`extensions`), com override explícito do owner.
- Sem o escopo → `403 forbidden_scope`. Sem rate-limit disponível → `429`.

## 4. Rotação e revogação

- **Rotacionar**: `POST /api/v1/api-keys/{id}/rotate` — em uma única transação: cria chave nova (mesmos escopos/nome, prefixo novo), marca a antiga `revoked_at=now()`, registra `audit_log` (`api_key.rotate`). A chave nova aparece **uma vez**.
- **Revogar**: `POST /api/v1/api-keys/{id}/revoke` — impede uso imediato (verificação a cada request; cache de chave revogada ≤ 60 s).
- **Expiração**: `expires_at` opcional; expirada ⇒ `401 unauthorized` com código `key_expired`.
- **Suspensão de instalação**: `extension_installs.status = 'suspended'` bloqueia todas as chaves vinculadas à instalação.
- Rotação recomendada: a cada 90 dias ou a cada mudança de máquina/colaborador. Ver `docs/decisoes-em-aberto.md`.

## 5. Rate limit por chave

- Padrão: **60 req/min** por chave (coluna `rate_limit_per_minute`). Cabeçalhos `X-RateLimit-*` em toda resposta; excesso ⇒ `429` + `Retry-After`.
- Implementação Fase 1: contador no Postgres (tabela dedicada ou upsert em `api_keys.last_used_at` + `audit_log`) ou na Vercel Edge Config; evolução para Redis/Upstash registrada em decisões em aberto.
- A pausa entre envios em massa da extensão (300–500 ms) complementa o limite, não o substitui.

## 6. Guarda segura na extensão

1. **Armazenamento**: chave em `chrome.storage.local` (nunca `sync` — não sobe para as sync services do Google; nunca `localStorage` da página; nunca embutida no código). Em Chrome ≥ 116, `chrome.storage.local` já é criptografado em repouso pelo SO via DPAPI/Keychain.
2. **Entrada**: campo de senha no popup/options com botão "Salvar"; mascarar após salvar; nunca logar (`console.log` proibido com a chave).
3. **Transporte**: apenas `https://` para o domínio do hub — nunca `http`, nunca IPs crus.
4. **Permissões mínimas**: o `manifest.json` pede **só** os hosts necessários (ver seção 7).
5. **CSP**: sem `unsafe-eval`; scripts apenas do próprio pacote.
6. **Erros**: em `401/403`, a extensão para a fila, avisa "chave inválida/sem permissão" e não tenta de novo em loop.
7. **Uninstall**: botão "Desconectar" limpa `chrome.storage.local` e chama `POST /api-keys/{id}/revoke`.

## 7. O que muda no `manifest.json` da sua extensão

Antes (API privada de terceiro):
```json
{
  "manifest_version": 3,
  "host_permissions": ["https://api.terceiro.example.com/*"],
  "permissions": ["storage", "activeTab", "scripting"]
}
```

Depois (API do hub):
```json
{
  "manifest_version": 3,
  "name": "Orvia — Troca de Fotos",
  "version": "2.0.0",
  "permissions": ["storage"],
  "host_permissions": [
    "https://seu-app.vercel.app/*",
    "https://*.supabase.co/*"
  ]
}
```

O que muda na prática:

| Antes | Depois |
|---|---|
| Host do terceiro em `host_permissions` | Apenas o domínio do hub (e `*.supabase.co` só se a extensão fizer upload direto de signed URL — **recomendado: não fazer**; usar `POST /api/v1/.../image`) |
| Autenticação com token do terceiro | `X-API-Key: ck_live_...` (escopos limitados) |
| CORS resolvido "na base da confiança" | A API do hub responde **CORS** com `Access-Control-Allow-Origin: chrome-extension://<id-da-extensão>` (configurável por ambiente, ver abaixo), `Access-Control-Allow-Headers: X-API-Key, If-Match, Idempotency-Key, Content-Type`, `Access-Control-Allow-Methods: GET,POST,PATCH,PUT,DELETE,OPTIONS`, `Access-Control-Max-Age: 600` |
| Preflight frequente | `OPTIONS` curto-circuitado (204) no middleware da API |

Regras CORS no servidor (Fase 1):
- Allowlist por `Origin`: `chrome-extension://<id>` (fixo por extensão publicada) + `http://localhost:3000` (dev) + o domínio do hub. Qualquer outra origem → sem headers CORS (o navegador bloqueia).
- **Nunca** `Access-Control-Allow-Origin: *` com credenciais.
- `OPTIONS /api/v1/*` → 204 sem tocar no banco.
- Se a extensão for distribuída fora da Chrome Web Store (zip unpacked), o id muda por máquina — nesse caso, permitir `chrome-extension://*` é inseguro; o correto é publicar na Web Store (id estável) ou ter uma instalação "dev" por workspace com id registrado em `extension_installs`. Decisão em aberto registrada.

## 8. Handshake e detecção de versão

No primeiro uso após instalar (ou a cada 24 h), a extensão chama:
`POST /api/v1/extensions/installs/{id}/handshake` com `{ "version": "2.0.0" }`.
O servidor atualiza `extension_installs.version` e `last_seen_at`. Versões antigas demais (< última major suportada) recebem `426 upgrade_required` — a extensão mostra "atualize na Web Store".

## 9. Auditoria

Toda chamada autenticada por chave grava `audit_log` com `actor_type='api_key'`, `actor_id=api_keys.id`, `action` derivada da rota, e `metadata` com `extension_installs.id`. É o que permite responder "qual notebook trocou essa foto às 3h da manhã?".

## 10. Exemplo de esqueleto (ilustrativo — NÃO é código de produção)

```js
// service-worker.js (esqueleto)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "hub:replaceImage") {
    chrome.storage.local.get(["hubApiKey"], async ({ hubApiKey }) => {
      const res = await fetch(`https://seu-app.vercel.app/api/v1/menu/items/${msg.itemId}/image`, {
        method: "POST",
        headers: { "X-API-Key": hubApiKey, "If-Match": msg.etag },
        body: msg.formData, // multipart com o arquivo
      });
      sendResponse({ ok: res.ok, status: res.status, body: await res.json().catch(() => null) });
    });
    return true;
  }
});
```

## 11. Checklist de publicação de uma extensão nova

1. Registrar a extensão: `INSERT INTO extensions ...` (service role / SQL editor).
2. Criar chave com escopos mínimos no painel → instalar na extensão.
3. Verificar `last_seen_at` após o handshake.
4. Confirmar que `audit_log` mostra ações com `actor_type='api_key'`.
5. Documentar no `docs/` da extensão (README próprio em `apps/extensions/<nome>/`).


## 12. Implementação atual (2026-11-06)

- Tela **Extensões** (`/a/{ws}/extensoes`): gerar a chave (exibida uma única vez, com escopos e validade) e revogar. Só dono/coordenador (RLS).
- Hash: `sha256(chave)` em `api_keys.key_hash`; prefixo `ck_live_xxxx` em `key_prefix` (ver decisoes-em-aberto #3).
- Primeira extensão: `apps/extensions/orvia-ifood` (slug `orvia-ifood`, registrada na migration 0004). Fluxo e segurança no README dela.
- CORS: a extensão chama pelo service worker (host_permissions), então não precisa de CORS. Preflight só para origens em `ALLOWED_EXTENSION_ORIGINS`.
