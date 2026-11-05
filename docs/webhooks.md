# Webhooks — eventos, assinatura HMAC e reentrega

> Backup do banco antes de qualquer migração em produção. Detalha o módulo de webhooks do hub (destino de integrações externas: n8n, Zapier, Make, sistemas do cliente).

## 1. Visão geral

```text
Ação no hub (ex.: foto trocada)
   └─▶ API grava no outbox (tabela webhook_deliveries, status='pending')
          └─▶ worker (Vercel Cron a cada 1 min ou Supabase Scheduled Function)
                └─▶ POST {url} com corpo assinado
                      ├─ 2xx → delivered_at, status='delivered'
                      ├─ 4xx/timeout/5xx → attempt+1, next_retry_at = backoff(attempt)
                      └─ attempt ≥ 8 ou falhas consecutivas ≥ 20 → status='gave_up', webhook auto-desativado
```

Garantia: **at-least-once**. O receptor deve ser idempotente (usar `X-Hub-Delivery` como chave de deduplicação).

## 2. Eventos (Fase 1)

| Evento | Quando dispara | Payload (campos principais) |
|---|---|---|
| `client.created` / `client.updated` / `client.archived` | CRUD de clientes | `{ id, name, status, delivery_status, ... }` (sem PII desnecessária: nunca `document`) |
| `menu.category.created` / `.updated` / `.deleted` | Categorias | `{ id, client_id, name, status, sort_order }` |
| `menu.item.created` / `.updated` / `.deleted` | Itens | `{ id, client_id, category_id, name, price, status, updated_at }` |
| `menu.addon_group.created` / `.updated` / `.deleted` | Grupos de complementos | `{ id, client_id, name, min_qty, max_qty }` |
| `menu.subitem.created` / `.updated` / `.deleted` | Opções | `{ id, group_id, name, price_delta, status }` |
| `menu.image.replaced` / `menu.image.removed` / `menu.image.restored` | Troca/remoção/restauração de foto | `{ owner_type, owner_id, version, checksum_sha256, replaced_by_type, reason }` |
| `api_key.rotated` / `api_key.revoked` | Rotação/revogação de chave | `{ api_key_id, name, key_prefix }` (nunca o hash) |
| `webhook.test` | Teste manual pelo painel | `{ message: "ping" }` |

Formato do envelope (todo evento):
```json
{
  "id": "evt_01J...",
  "type": "menu.image.replaced",
  "created_at": "2026-11-04T12:00:00Z",
  "workspace_id": "uuid",
  "data": { "...": "..." }
}
```

## 3. Assinatura HMAC-SHA256

Cada webhook tem um `secret` (gerado no cadastro, exibido uma única vez; armazenar criptografado — Supabase Vault/`pgsodium` — nunca em claro em logs).

Cabeçalhos de cada entrega:
```http
X-Hub-Event: menu.image.replaced
X-Hub-Delivery: 3fa8c2d1-...           (id único da entrega — use p/ idempotência)
X-Hub-Signature-256: sha256=<hmac hex>
User-Agent: orvia-webhooks/1.0
Content-Type: application/json
```

Cálculo (receptor):
```text
signature = HMAC_SHA256(secret, raw_body_bytes)   // corpo cru, sem re-serializar
expected = "sha256=" + hex(signature)
comparar em tempo constante (timingSafeEqual) com X-Hub-Signature-256
```
Rejeitar se: header ausente, divergência de bytes, `created_at` do envelope com mais de 5 min de diferença (tolerância a replay).

Esqueleto de verificação (Node, ilustrativo):
```js
const hmac = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
const ok = crypto.timingSafeEqual(Buffer.from(`sha256=${hmac}`), Buffer.from(header));
```

## 4. Reentrega com backoff

| Tentativa | Espera (aprox.) |
|---|---|
| 1 | imediato |
| 2 | +1 min |
| 3 | +5 min |
| 4 | +15 min |
| 5 | +1 h |
| 6 | +3 h |
| 7 | +6 h |
| 8 | +12 h → `gave_up` |

- Fórmula: `next_retry_at = now() + min(12h, 60s * 5^attempt) + jitter(±20%)`.
- Sucesso = HTTP 2xx em até 10 s. Resposta é truncada em 2 KB e guardada em `webhook_deliveries.response_body`.
- `4xx` (exceto 408/429) conta como falha definitiva do payload, mas segue o mesmo backoff (o receptor pode estar com bug).
- **Auto-desativação**: `failure_count >= 20` ⇒ `webhooks.is_active = false` + e-mail/WhatsApp opcional para o owner (Fase 3). Painel mostra banner "webhook desativado".
- Retry manual: `POST /api/v1/webhooks/{id}/deliveries/{delivery_id}/retry` (escopo `webhooks:gerenciar`).
- Worker: Vercel Cron (`*/1 * * * *`) chamando rota protegida `/api/cron/webhooks` com `CRON_SECRET`, ou `pg_cron` + `pg_net`. Lease/lock com `FOR UPDATE SKIP LOCKED` para não entregar em dobro.

## 5. Gestão pela API (escopo `webhooks:gerenciar`)

Ver `docs/api.md` §4.6 — criar, editar, remover, listar entregas, retry, teste. Criação:
```json
POST /api/v1/webhooks
{ "name": "n8n - sync cardápio", "url": "https://n8n.exemplo.com/webhook/abc",
  "events": ["menu.item.updated", "menu.image.replaced"] }
```
Resposta `201` inclui `"secret": "whsec_..."` **uma única vez**. Depois disso só se vê o prefixo.

## 6. Segurança

- Apenas URLs `https://` (check no banco + na API). Sem `http://`, sem IPs, sem `localhost` em produção.
- Proteção SSRF: resolver DNS e bloquear faixas privadas (10/8, 172.16/12, 192.168/16, 127/8, ::1, 169.254/16) antes de entregar; seguir no máximo 3 redirects, sempre revalidando.
- Segredo: rotação anual ou suspeita de vazamento (novo `secret` na edição do webhook invalida o antigo imediatamente).
- Payload nunca contém chaves de API, hashes, senhas ou documentos pessoais (`document`, `phone`, `email`) — só IDs e dados operacionais.
- `audit_log` registra criação/edição/remoção de webhooks e desativação automática.

## 7. LGPD

Webhooks podem carregar dados operacionais para fora do hub — documente no contrato/DPA do cliente quais destinos recebem eventos. `menu.image.*` e `menu.item.*` não são dados pessoais; `client.*` traz apenas nome fantasia e status. IP/UA do receptor não são armazenados.
