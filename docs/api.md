# API Pública – Cardápio Web Hub

## Visão Geral
API REST para integração com extensões de navegador e clientes externos.
Base URL: `https://api.seudominio.com/api/v1`

## Autenticação
Todas as requisições (exceto listagem pública) exigem header:
```
X-API-KEY: card_live_xxxxxxxxxxxxxxxx
```

A chave deve ser criada no painel admin. Apenas o **hash** é armazenado no banco.

## Endpoints

### Produtos

| Método | Rota | Descrição | Escopo |
|--------|------|-----------|--------|
| GET | `/api/v1/produtos` | Listar produtos (paginado) | `catalogo:ler` |
| GET | `/api/v1/produtos/{id}` | Obter produto por ID | `catalogo:ler` |
| POST | `/api/v1/produtos` | Criar produto | `catalogo:escrever` |
| PUT | `/api/v1/produtos/{id}` | Atualizar produto | `catalogo:escrever` |
| DELETE | `/api/v1/produtos/{id}` | Excluir produto | `catalogo:escrever` |
| PUT | `/api/v1/produtos/{id}/imagem` | Substituir imagem do produto | `catalogo:escrever` |

### Relatórios
| Método | Rota | Descrição | Escopo |
|--------|------|-----------|--------|
| GET | `/api/v1/relatorios` | Listar relatórios | `relatorios:ler` |
| GET | `/api/v1/relatorios/{id}` | Detalhe do relatório | `relatorios:ler` |

### Webhooks
| Método | Rota | Descrição | Escopo |
|--------|------|-----------|--------|
| GET | `/api/v1/webhooks` | Listar webhooks | `webhooks:ler` |
| POST | `/api/v1/webhooks` | Criar webhook | `webhooks:escrever` |
| DELETE | `/api/v1/webhooks/{id}` | Remover webhook | `webhooks:escrever` |

### Extensões
| Método | Rota | Descrição | Escopo |
|--------|------|-----------|--------|
| GET | `/api/v1/extensoes` | Listar extensões instaladas | `extensoes:ler` |
| POST | `/api/v1/extensoes` | Registrar extensão | `extensoes:escrever` |

## Códigos de Resposta
- `200` – Sucesso
- `201` – Criado
- `400` – Requisição inválida
- `401` – Não autenticado (chave inválida ou ausente)
- `403` – Sem permissão (escopo insuficiente)
- `404` – Não encontrado
- `429` – Limite de requisições excedido
- `500` – Erro interno

## Controle de Concorrência
Todas as atualizações (PUT/DELETE) devem incluir o cabeçalho:
```
If-Match: <ultimo_valor_de_updated_at>
```
Se o `updated_at` no banco for diferente do enviado, retorna `409 Conflict` para evitar sobrescrita acidental.

## Paginação
Query params: `?page=1&limit=20`
Resposta inclui:
```json
{
  "data": [...],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "total_pages": 8
  }
}
```

## Erros
Formato padronizado:
```json
{
  "erro": "codigo_do_erro",
  "mensagem": "Descrição amigável do erro",
  "detalhes": {}
}
```
