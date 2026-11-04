# Webhooks

## Visão Geral
O hub pode enviar notificações em tempo real para URLs externas quando eventos importantes ocorrem no cardápio ou produtos.

## Eventos Suportados
| Evento | Descrição |
|--------|-----------|
| `menu.item.created` | Novo produto criado |
| `menu.item.updated` | Produto atualizado (preço, descrição, status) |
| `menu.item.deleted` | Produto excluído |
| `menu.item.image_replaced` | Imagem do produto alterada |
| `menu.category.created` | Nova categoria criada |
| `cliente.created` | Novo cliente cadastrado |

## Assinatura HMAC
Cada requisição de webhook inclui o header:
```
X-Webhook-Signature: sha256=<hash>
```

O hash é calculado usando a chave secreta do webhook (`secreto`) sobre o corpo da requisição (raw body):
```
HMAC_SHA256(secreto, corpo_da_requisicao)
```

O destinatário deve verificar a assinatura antes de processar o evento.

## Reentrega com Backoff
Se o endpoint de destino retornar status diferente de `2xx`:
1. Primeira tentativa: imediata
2. Segunda tentativa: após 1 minuto
3. Terceira tentativa: após 5 minutos
4. Quarta tentativa: após 15 minutos
5. Quinta tentativa: após 1 hora

Após 5 falhas consecutivas, o webhook é desativado temporariamente e o admin é notificado.

## Tabela: webhook_deliveries
Armazena cada tentativa de entrega:
- `webhook_id`
- `evento`
- `payload` (JSON)
- `status_code`
- `resposta`
- `tentativas`
- `enviado_em`

## Exemplo de Payload
```json
{
  "evento": "menu.item.image_replaced",
  "data": {
    "produto_id": "uuid-do-produto",
    "nome": "X-Burguer",
    "imagem_anterior": "https://.../antiga.jpg",
    "imagem_nova": "https://.../nova.jpg",
    "alterado_por": "usuario-id",
    "alterado_em": "2024-01-15T10:30:00Z"
  }
}
```

## Segurança
- Valide o HMAC antes de processar qualquer evento.
- Valide que o `workspace_id` pertence à sua aplicação.
- Idempotência: use o `id` do delivery para evitar processamento duplicado.
