# Integração com Extensões de Navegador

## Visão Geral
O hub expõe uma API REST autenticada que permite extensões de navegador (Chrome Manifest V3) lerem e escreverem dados do cardápio, produtos e preços.

## Arquitetura
```
Extensão Chrome  ──(X-API-KEY)──>  API do Hub  ──>  Supabase (Postgres + Storage)
```

## Requisitos no Manifest (`manifest.json`)
```json
{
  "manifest_version": 3,
  "name": "Minha Extensão Cardápio",
  "version": "1.0.0",
  "permissions": ["storage", "tabs"],
  "host_permissions": [
    "https://seu-projeto.supabase.co/*",
    "https://seu-dominio.com/api/v1/*"
  ],
  "content_scripts": [
    {
      "matches": ["https://portal.cardapioweb.com/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": []
}
```

### CORS
O servidor Next.js deve permitir origens `chrome-extension://<ID_DA_EXTENSAO>`:
```javascript
// next.config.js ou middleware
headers: [
  {
    key: 'Access-Control-Allow-Origin',
    value: 'chrome-extension://<ID>',
  },
  {
    key: 'Access-Control-Allow-Methods',
    value: 'GET, POST, PUT, DELETE, OPTIONS',
  },
  {
    key: 'Access-Control-Allow-Headers',
    value: 'X-API-KEY, Content-Type',
  },
]
```

## Fluxo de Autenticação
1. Usuário cria uma chave de API no painel do hub (`/admin/chaves-api`).
2. A chave completa (`card_live_xxx`) é exibida **apenas uma vez**.
3. O usuário cola a chave na extensão.
4. A extensão armazena a chave no `chrome.storage.local` (apenas localmente).
5. A extensão envia a chave no header `X-API-KEY` em cada requisição.

## Escopos de Chave (Scopes)
Cada chave pode ter um ou mais escopos:
- `catalogo:ler` – listar produtos e categorias
- `catalogo:escrever` – criar, atualizar, excluir produtos e imagens
- `clientes:ler` – listar clientes
- `relatorios:ler` – listar relatórios
- `webhooks:ler` / `webhooks:escrever` – gerenciar webhooks

## Limites de Requisição
- Limite padrão: 100 requisições por chave por dia.
- Configurável por chave no painel admin.
- Resposta `429 Too Many Requests` quando excedido.

## Exemplo de Requisição
```bash
curl -X GET https://seu-dominio.com/api/v1/produtos \
  -H "X-API-KEY: card_live_xxxxxxxxxxxxxxxx" \
  -H "Accept: application/json"
```

## Segurança
- Chave é armazenada apenas com hash (bcrypt) no banco.
- A chave completa é exibida uma única vez na criação.
- Pode ser rotacionada ou revogada a qualquer momento pelo admin.
- Todas as requisições são registradas em `webhook_deliveries` ou log de auditoria.
