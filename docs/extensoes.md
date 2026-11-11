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

## 13. Dois canais: iFood e Cardápio Web (2026-11-09)

```text
 extensão (login e-mail+senha)                hub
 ─────────────────────────────                ───────────────────────────────────────────
 orvia-ifood        ──POST /extension-auth/login──►  detectExtensionSlug(req, body.extension)
 orvia-cardapioweb  ──  (Origin chrome-extension://onolpce…)  1) body.extension  2) Origin  3) iFood
                                                     │
                                                     ▼
                                        api_keys.extension_id = extensão detectada
                                                     │  (toda chamada seguinte usa a chave)
                    ┌────────────────────────────────┼─────────────────────────────────┐
                    ▼                                ▼                                 ▼
        clients/ensure, menu/import       optimizations (POST)               painel /a/{ws}/extensoes
        trava de loja do CANAL:           menu_optimizations.platform        abas iFood | Cardápio Web,
        ifood_merchant_id ou              = 'ifood' | 'cardapioweb'          prints com "Baixar" e
        cardapioweb_store_id                                                 "Baixar todos"
```

- Migration `0006_cardapioweb_channel.sql`: extensão `orvia-cardapioweb` no catálogo, `clients.cardapioweb_store_id` (índice único por workspace) e `menu_optimizations.platform`. Teste: `supabase/tests/cardapioweb_channel.sql`.
- Id do Chrome da extensão Cardápio Web 0.3.x (do `key` do manifest): `onolpcebolaabfapfnmemokkinncppok`. Outro id (nova chave de manifest) → env `CARDAPIOWEB_EXTENSION_IDS` (lista por vírgula). Versões novas das extensões devem mandar `extension: "orvia-cardapioweb" | "orvia-ifood"` no login (não depender do Origin) e corrigir o `manifest_name` do handshake (a 0.3.0 envia "Otimizador iFood").
- **Quem já tinha feito login na extensão Cardápio Web antes da 0006 precisa sair e entrar de novo** dentro dela: a chave antiga foi criada como iFood. O novo login revoga a chave antiga do mesmo dispositivo. Otimizações enviadas antes da 0006 ficam na aba iFood (não há como distinguir com segurança).
- Contrato da API inalterado (campo aditivo `extension` no login; respostas com `extension`/`platform`). Para a extensão Cardápio Web, `ifood_merchant_id` em `GET /clients` e `POST /clients/ensure` significa "id da loja no canal da chave" — compatibilidade com a 0.3.x.
- **Risco em aberto:** o cardápio importado (`menu_items`/`menu_categories`) ainda é **um por cliente**, sem canal. Se o mesmo cliente importa do iFood e do Cardápio Web, os itens se misturam (o vínculo usa `ifood_id`). Recomendação: na próxima migration, `menu_*.channel` ou ids por canal (`cardapioweb_id`), e a importação filtrar por canal. Até lá, use clientes distintos ou importe por um canal só.

## 14. Terceiro canal: Anota AI + painel de conexão (decidido em 2026-11-11)

- Migration `0008_anotaai_channel.sql` (aditiva): registra `orvia-anotaai` no catálogo, cria `clients.anotaai_store_id` (trava de loja própria) e amplia `menu_optimizations.platform` para `ifood | cardapioweb | anotaai`.
- `lib/api/extensions.ts`: slug `orvia-anotaai` → canal `anotaai` ("Anota AI"). O canal continua vindo da **chave** (`api_keys.extension_id`); a extensão Anota AI pode também mandar `extension: "orvia-anotaai"` no login.
- Tela **Extensões** → painel **Conexão das extensões** com uma aba por extensão (iFood / Cardápio Web / Anota AI): mostra Conectada / sem contato recente / Não conectada (`extension_installs.last_seen_at`, renovado pelo `POST /extensions/handshake`).
- Se não estiver conectada: **Gerar código de conexão** (`pairExtensionAction`) cria uma chave vinculada à extensão da aba (escopos mínimos, 365 dias) e mostra o código **uma vez** (Mostrar/Copiar) + o endereço do Orvia, para colar nas opções da extensão. O banco guarda só o hash.
- A extensão Anota AI em si (Chrome MV3) ainda não existe no repositório: ela deve seguir o mesmo contrato das outras (`docs/integracao-extensoes-hub.md`), com `host_permissions` só do hub.
