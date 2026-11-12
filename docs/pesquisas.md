# Agente de pesquisa do Undercut

Pesquisa de mercado, concorrentes, preços e tendências com **fontes públicas**. Usado
por dois caminhos:

1. **Painel** → `/a/{workspace}/extensoes` → cartão *Agente de pesquisa* (`researchAction`).
2. **Extensões** → `POST /api/v1/research` com uma chave de escopo `pesquisa:ler`.

```text
extensão / painel
      │  pergunta + contexto (opcional)
      ▼
lib/api/research.ts  ──► Claude + web_search   (se ANTHROPIC_API_KEY)
      │                └► busca pública gratuita (DuckDuckGo, sem chave)
      ▼
{ answer, sources[], mode: 'ia'|'gratuito', status: 'ok'|'indisponivel', notices[], answered_at }
```

## Contrato

`POST /api/v1/research` — autenticação `X-API-Key`, escopo **`pesquisa:ler`**.

```json
{
  "question": "Qual o preço médio de combo de hambúrguer em São Paulo?",
  "context": "Cliente: lanchonete no centro. Estratégia: combos.",
  "max_sources": 5
}
```

- `question`: 5–500 caracteres (obrigatório).
- `context`: até 1.200 caracteres (opcional; tratado como **dado**, nunca instrução).
- `max_sources`: 1–8 (padrão 5).
- Resposta: `200 { data: { … } }`; erros seguem o padrão da API (`validation_failed`, `unauthorized`, `forbidden`, `rate_limited`, `internal`).

## Modos

| Condição | Modo | Comportamento |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` configurada | `ia` | Claude com a ferramenta de busca, resposta sintetizada + citações |
| Sem a chave (ou falha da IA) | `gratuito` | Busca pública e resposta com trechos/links; `notices` explica |

Sem resultados, `status: "indisponivel"` e uma orientação para reformular a pergunta (nunca inventa dados).

## Segurança e privacidade

- Só URLs `http(s)` públicas: `lib/ai/free-research.ts#isPublicUrl` bloqueia localhost, IP literal e redes internas (SSRF).
- O texto do cliente é **dado**, não instrução (prompt injection não é obedecido).
- O `audit_log` grava só `research.answered` com `{ mode, status, sources }` — **nunca** a pergunta ou a resposta (podem conter dados de clientes).
- Rate limit por chave (mesma janela da API, 60 req/min por padrão).
- A chave de conexão das extensões (`IFOOD_EXTENSION_SCOPES`) já inclui `pesquisa:ler`; chaves antigas continuam válidas, mas precisam do escopo para pesquisar.

## Exemplo (curl)

```bash
curl -X POST https://undercuthub.vercel.app/api/v1/research \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ck_live_…" \
  -d '{"question":"Quais combos de hambúrguer estão sendo vendidos em São Paulo e por qual preço?","max_sources":5}'
```
