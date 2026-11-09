# API pública `/api/v1` — Orvia

> Contrato REST/JSON para o painel e para extensões Chrome. **Base URL:** `{NEXT_PUBLIC_APP_URL}/api/v1`
> Fonte única da verdade para tipos: `docs/openapi.yaml` (gerar `packages/api-types` a partir dele).
> Backup do banco antes de qualquer migração em produção.

## 1. Autenticação

Duas formas de credencial — **nunca as duas ao mesmo tempo**:

| Credencial | Uso | Header |
|---|---|---|
| Sessão do painel (Supabase Auth cookie) | Usuários humanos no painel | (cookie `sb-*`, automático) |
| Chave de API de extensão | Extensões Chrome MV3 | `X-API-Key: ck_live_...` |

A API **valida a chave contra o hash** (`api_keys.key_hash`), checa `revoked_at`, `expires_at`, rate limit e **escopos**. Toda resposta de erro segue o envelope:

```json
{ "error": { "code": "forbidden_scope", "message": "Chave sem escopo catalogo:escrever", "details": {} } }
```

## 2. Escopos (ver docs/extensoes.md)

| Escopo | Permite |
|---|---|
| `clientes:ler` | GET em `/clients*` |
| `clientes:escrever` | POST/PATCH/DELETE em `/clients*` |
| `catalogo:ler` | GET em `/menu/*` |
| `catalogo:escrever` | POST/PATCH/DELETE em `/menu/*`, imagens, histórico e restore |
| `webhooks:gerenciar` | CRUD em `/webhooks*` |
| `extensoes:ler` | GET em `/extensions*` (diagnóstico) |

Chaves sem o escopo exigido recebem `403 forbidden_scope`. Escopos são concedidos na criação da chave e não podem ser ampliados depois (só criando chave nova).

## 3. Convenções globais

- **Content-Type**: `application/json; charset=utf-8` (uploads de imagem: `multipart/form-data` ou `{"image_base64":"..."}`).
- **IDs**: UUID v4. **Datas**: ISO-8601 UTC (`2026-11-04T12:00:00Z`).
- **Dinheiro**: número com 2 casas (`129.90`), em reais.
- **Paginação**: `?page=1&page_size=50` — `page_size` máx. 200 (padrão 50). Resposta inclui `meta: { page, page_size, total, total_pages }`.
- **Ordenação**: `?order=created_at.desc` (campos permitidos por endpoint; padrão `created_at.desc`).
- **Filtros**: por campo, ex.: `?status=active&client_id=<uuid>&q=burger` (`q` = busca textual em nome/descrição).
- **Soft-delete**: entidades com `archived_at` só aparecem com `?include_archived=true`.
- **Edição concorrente (If-Match)**: toda entidade mutável retorna `updated_at` e um header `ETag: "<updated_at-iso>"`. Em `PATCH/PUT/DELETE`, o cliente **deve** enviar `If-Match: "<etag>"`. Se o valor não bate, o servidor responde **`409 conflict`** com `{ current: { updated_at, ...campos-chave } }`. Sem `If-Match`, a API responde `428 precondition_required` (nunca sobrescreve silenciosamente).
- **Rate limit**: headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`. Excesso → `429 rate_limited` (com `Retry-After`).
- **Idempotência**: POSTs de criação aceitam `Idempotency-Key: <uuid>`; replay dentro de 24 h retorna a resposta original.
- **Erros**: `400 invalid_input` · `401 unauthorized` · `403 forbidden_scope` · `404 not_found` · `409 conflict` · `422 validation_failed` (detalhes por campo) · `428 precondition_required` · `429 rate_limited` · `500 internal`.
- **Validação**: Zod no servidor; saída sanitizada (React escapa por padrão; nunca `dangerouslySetInnerHTML` sem sanitização). Toda query via cliente Supabase/parametrizada — zero SQL concatenado.
- **Auditoria**: toda escrita gera `audit_log` (ator = usuário ou chave de API).

## 4. Endpoints

### 4.1 Clients

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/clients` | `clientes:ler` | Lista paginada. Filtros: `status`, `delivery_status`, `tag`, `q`, `include_archived` |
| POST | `/clients` | `clientes:escrever` | Cria cliente |
| GET | `/clients/{id}` | `clientes:ler` | Detalhe (inclui tags, contas de anúncio resumidas, cardápio resumido) |
| PATCH | `/clients/{id}` | `clientes:escrever` | Atualiza (If-Match obrigatório) |
| DELETE | `/clients/{id}` | `clientes:escrever` | Arquiva (`archived_at`); owner/coordenador no painel |
| GET | `/clients/{id}/tags` | `clientes:ler` | Lista tags do cliente |
| PUT | `/clients/{id}/tags` | `clientes:escrever` | Substitui conjunto de tags: `{ "tag_ids": ["..."] }` |
| GET | `/tags` | `clientes:ler` | Lista tags do workspace |
| POST | `/tags` | `clientes:escrever` | Cria tag `{ "name", "color" }` |
| DELETE | `/tags/{id}` | `clientes:escrever` | Remove tag (desvincula dos clientes) |

`POST /clients` — corpo:
```json
{
  "name": "Pizzaria do Zé",
  "legal_name": "Zé Pizzas Ltda",
  "document": "00.000.000/0001-00",
  "contact_name": "José",
  "email": "ze@example.com",
  "phone": "+55 11 90000-0000",
  "whatsapp": "+55 11 90000-0000",
  "instagram": "@pizzariadoze",
  "monthly_fee": 1500.00,
  "delivery_status": "no_prazo",
  "status": "ativo",
  "notes": "Cliente desde jan/2026"
}
```
Resposta `201`:
```json
{ "data": { "id": "uuid", "workspace_id": "uuid", "name": "Pizzaria do Zé", "...": "...", "created_at": "2026-11-04T12:00:00Z", "updated_at": "2026-11-04T12:00:00Z" } }
```

### 4.2 Menu — categorias

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/menu/categories?client_id=` | `catalogo:ler` | Lista categorias do cliente (ordenadas por `sort_order`) |
| POST | `/menu/categories` | `catalogo:escrever` | Cria `{ "client_id", "name", "description"?, "sort_order"?, "status"? }` |
| PATCH | `/menu/categories/{id}` | `catalogo:escrever` | Atualiza (If-Match) |
| DELETE | `/menu/categories/{id}` | `catalogo:escrever` | Remove (bloqueia se houver itens: `409 has_items`) |

### 4.3 Menu — itens (produtos)

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/menu/items?client_id=&category_id=&status=&q=` | `catalogo:ler` | Lista paginada |
| POST | `/menu/items` | `catalogo:escrever` | Cria item |
| GET | `/menu/items/{id}` | `catalogo:ler` | Detalhe (categoria, grupos de complementos, imagem corrente) |
| PATCH | `/menu/items/{id}` | `catalogo:escrever` | Atualiza `name`, `description`, `price`, `status` (`active|inactive|out_of_stock`), `sort_order`, `category_id`, `sku` (If-Match) |
| DELETE | `/menu/items/{id}` | `catalogo:escrever` | Remove item (e sua imagem corrente + histórico entram em quarentena de 90 dias) |
| GET | `/menu/items/{id}/addon-groups` | `catalogo:ler` | Grupos vinculados ao item |
| PUT | `/menu/items/{id}/addon-groups` | `catalogo:escrever` | Substitui vínculos: `{ "group_ids": [{ "id": "uuid", "sort_order": 0 }] }` |

`POST /menu/items` — corpo:
```json
{
  "client_id": "uuid",
  "category_id": "uuid",
  "sku": "LAN-001",
  "name": "X-Burger Clássico",
  "description": "Hambúrguer artesanal 150g, queijo, salada e molho da casa",
  "price": 32.90,
  "status": "active",
  "sort_order": 10
}
```

### 4.4 Menu — grupos de complementos e opções (subitens)

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/menu/addon-groups?client_id=` | `catalogo:ler` | Lista grupos |
| POST | `/menu/addon-groups` | `catalogo:escrever` | Cria `{ "client_id", "name", "min_qty"?, "max_qty"?, "sort_order"? }` |
| PATCH | `/menu/addon-groups/{id}` | `catalogo:escrever` | Atualiza (If-Match) |
| DELETE | `/menu/addon-groups/{id}` | `catalogo:escrever` | Remove grupo (subitens em cascata; vínculos a itens removidos) |
| GET | `/menu/addon-groups/{id}/subitems` | `catalogo:ler` | Lista opções do grupo |
| POST | `/menu/addon-groups/{id}/subitems` | `catalogo:escrever` | Cria `{ "name", "price_delta"?, "sort_order"?, "status"? }` |
| PATCH | `/menu/subitems/{id}` | `catalogo:escrever` | Atualiza (If-Match) |
| DELETE | `/menu/subitems/{id}` | `catalogo:escrever` | Remove opção |

### 4.5 Imagens

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| POST | `/menu/items/{id}/image` | `catalogo:escrever` | Substitui foto do produto (multipart ou base64). `If-Match` do item obrigatório |
| POST | `/menu/subitems/{id}/image` | `catalogo:escrever` | Substitui foto da opção |
| DELETE | `/menu/items/{id}/image` | `catalogo:escrever` | Remove foto corrente (vai para histórico; item fica sem foto) — `If-Match` obrigatório |
| DELETE | `/menu/subitems/{id}/image` | `catalogo:escrever` | Idem para opção |
| GET | `/menu/items/{id}/image` | `catalogo:ler` | Metadados + signed URL (TTL 15 min) |
| GET | `/menu/items/{id}/image/history` | `catalogo:ler` | Lista versões anteriores (paginado) |
| POST | `/menu/items/{id}/image/restore` | `catalogo:escrever` | Restaura: `{}` = anterior; `{ "version": 3 }` = versão específica. Gera **nova versão**, nunca sobrescreve |
| GET | `/images/{image_id}/content` | `catalogo:ler` | Proxy do binário (signed redirect 302) |

Upload `multipart/form-data`: campo `file` + query `?reason=bulk_extension` (opcional). Resposta `200`:
```json
{
  "data": {
    "id": "uuid",
    "owner_type": "menu_item",
    "owner_id": "uuid",
    "version": 4,
    "storage_path": "ws/client/menu_item/item/4.webp",
    "checksum_sha256": "…",
    "width": 1080, "height": 1350,
    "created_at": "2026-11-04T12:00:00Z"
  }
}
```
Erros específicos: `415 unsupported_media_type`, `413 payload_too_large`, `409 conflict` (If-Match divergente — foto ou nome mudaram).

### 4.6 Webhooks (gestão)

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/webhooks` | `webhooks:gerenciar` | Lista webhooks do workspace |
| POST | `/webhooks` | `webhooks:gerenciar` | Cria `{ "name", "url" (https), "events": [...], "secret"? }` — secret gerado se ausente; **exibido uma única vez** |
| PATCH | `/webhooks/{id}` | `webhooks:gerenciar` | Atualiza `name`, `url`, `events`, `is_active` (If-Match) |
| DELETE | `/webhooks/{id}` | `webhooks:gerenciar` | Remove webhook e suas entregas pendentes |
| GET | `/webhooks/{id}/deliveries` | `webhooks:gerenciar` | Entregas recentes (filtro `status=pending|delivered|failed|gave_up`) |
| POST | `/webhooks/{id}/deliveries/{delivery_id}/retry` | `webhooks:gerenciar` | Reenfileira entrega com `attempt+1` |
| POST | `/webhooks/{id}/test` | `webhooks:gerenciar` | Envia evento `webhook.test` assinado |

### 4.7 Extensões (diagnóstico e ciclo de vida)

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| GET | `/extensions` | `extensoes:ler` | Catálogo global de extensões conhecidas |
| GET | `/extensions/installs` | `extensoes:ler` | Instalações do workspace (com `last_seen_at`, `version`) |
| POST | `/extensions/installs/{id}/handshake` | (chave da própria extensão) | Extensão informa `version` e `manifest_name`; atualiza `last_seen_at` |
| GET | `/api-keys` | `extensoes:ler` (e sessão owner/coordenador no painel) | Lista chaves (prefixo, escopos, `last_used_at`, `expires_at`; **nunca o hash**) |
| POST | `/api-keys` | (painel owner/coordenador) | Cria chave `{ "name", "extension_id"?, "scopes": [...], "rate_limit_per_minute"?, "expires_at"? }` — resposta inclui `key` em claro **uma única vez** |
| POST | `/api-keys/{id}/rotate` | (painel owner/coordenador) | Gera nova chave, revoga a anterior na mesma operação |
| POST | `/api-keys/{id}/revoke` | (painel owner/coordenador) | Define `revoked_at=now()` |

## 5. Controle de edição concorrente — detalhe

Toda linha mutável carrega `updated_at`. Fluxo para a extensão (conferência antes de aplicar):

1. `GET /menu/items/{id}` → recebe `ETag: "2026-11-04T12:00:00.123Z"`.
2. Monta o diff local (nome, foto, preço…).
3. `PATCH /menu/items/{id}` com `If-Match: "2026-11-04T12:00:00.123Z"`.
4. Se outro processo alterou o item nesse meio-tempo → `409 conflict` com `{ "current": { "updated_at": "...", "name": "...", "image_version": 5 } }`. A extensão marca `conflict` no relatório e **não aplica**.

Regra de ouro para implementadores: **nenhuma escrita sem If-Match**; `updated_at` é atualizado por trigger; `If-Match` é comparado com tolerância zero (string exata do ETag).

## 6. Paginação e filtros — exemplo de resposta de lista

```json
{
  "data": [ { "id": "…", "name": "…" } ],
  "meta": { "page": 1, "page_size": 50, "total": 137, "total_pages": 3 }
}
```

## 7. Webhooks emitidos por esta API (resumo — detalhes em docs/webhooks.md)

`client.created|updated|archived`, `menu.category.created|updated|deleted`, `menu.item.created|updated|deleted`, `menu.subitem.created|updated|deleted`, `menu.addon_group.created|updated|deleted`, `menu.image.replaced|removed|restored`, `api_key.rotated|revoked`, `webhook.test`.

## 7.1 Cardápio ↔ iFood — implementado (2026-11-06)

Endpoints já ativos (Route Handlers em `app/api/v1/`). Os demais da §4 continuam planejados. São todos aditivos.

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| POST | `/extension-auth/login` | (sem chave) | Login de usuário na extensão `{ email, password, device_id, workspace_slug? }` → `{ key }` (escopos mínimos, 365 dias; 8 tentativas/min/IP; mesmo dispositivo revoga a chave anterior). Pode responder `{ needs_workspace, workspaces }` |
| GET | `/me` | (qualquer chave válida) | Workspace + escopos da chave ("Testar conexão") |
| POST | `/extensions/handshake` | (chave vinculada a extensão) | `{ version }` → upsert em `extension_installs` (`last_seen_at`) |
| GET | `/clients` | `clientes:ler` | Lista enxuta `{ id, name, ifood_merchant_id }` (sem PII) |
| GET | `/menu?client_id=` | `catalogo:ler` | Catálogo completo (categorias, itens/combos, complementos). `ETag` = versão do catálogo |
| POST | `/menu/import` | `catalogo:escrever` | Snapshot do iFood → Orvia. **If-Match = ETag de `/menu`** (428 sem, 409 divergente). 409 `merchant_mismatch` se a loja não for a vinculada |
| GET | `/menu/pending?client_id=` | `catalogo:ler` | Fila "aplicar no iFood": itens/combos com `updated_at > ifood_synced_at` (ou nunca sincronizados), com `etag` por item |
| GET/PATCH | `/menu/items/{id}` | `catalogo:ler` / `catalogo:escrever` | PATCH de `name, description, price, status, sku, category_id, sort_order` com If-Match = `ETag` do GET |
| POST | `/menu/items/{id}/ifood-sync` | `catalogo:escrever` | Confirma que foi aplicado no iFood (`{ ifood_id? }`). If-Match = `etag` da pendência |
| POST | `/menu/combos` | `catalogo:escrever` | Cria combo `{ client_id, name, description, price, components:[{component_id, quantity}] }`. **Sempre nasce pausado** |

Regras da importação: nunca apaga; não sobrescreve item com edição local pendente (volta como `kept_local`); IDs sintéticos (`cat_N`, `synth_`, `dom_`) não viram `ifood_id`; item sem preço legível é ignorado (`skipped`).
ETag de linha = `updated_at` bruto do Postgres (com microssegundos). "Sincronizado" é gravado pela RPC `mark_menu_items_ifood_synced`, com o `now()` do banco.
Rate limit: janela de 1 min por chave, **em memória por instância** (ver decisoes-em-aberto #4). Testes: `supabase/tests/api_menu.mjs` (34 checks).

## 7.2 Extensão iFood v0.4 — cliente, análise e histórico (2026-11-08)

| Método | Rota | Escopo | Descrição |
|---|---|---|---|
| POST | `/clients/ensure` | `catalogo:escrever` | `{ name, ifood_merchant_id? }` → `{ id, name, ifood_merchant_id, created }`. Acha por `ifood_merchant_id`; senão por nome exato sem diferenciar maiúsculas (ignorando clientes já vinculados a OUTRA loja); senão cria (201). Idempotente; só preenche `ifood_merchant_id` quando NULL (nunca sobrescreve) |
| POST | `/analysis` | `catalogo:ler` | IA (+ concorrentes públicos opcionais) → sugestões. **Não grava nada.** Requer `ANTHROPIC_API_KEY`; sem ela → 500 com mensagem. Concorrentes indisponíveis não derrubam a resposta (`competitors_status`) |
| POST | `/optimizations` | `catalogo:escrever` | Salva plano aprovado + status por alteração + até 6 PNG (≤ 2,5 MB cada; corpo total ≤ ~4,5 MB, limite da Vercel) em bucket privado `optimization-evidence` |
| GET | `/optimizations?client_id=` | `catalogo:ler` | Últimas 20 otimizações do cliente, prints com URL assinada (10 min) |

POST de criação não usa If-Match (não há versão anterior a proteger). Tabelas: `menu_optimizations`, `menu_optimization_evidence` (migration 0005). Testes: `supabase/tests/api_clients_ensure.mjs` (12 checks).

## 8. Fora de escopo da Fase 1 (Fases futuras)

Cardápio público/pedidos, Meta Ads sync, relatórios semanais, envio de WhatsApp, rate-limit distribuído via Redis, SDKs. Ver `docs/roadmap-fase-1.md` e `docs/decisoes-em-aberto.md`.
