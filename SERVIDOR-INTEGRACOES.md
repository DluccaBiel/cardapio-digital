# Servidor Undercut — o que ele precisa aceitar para as 3 extensões

As três extensões usam o mesmo cliente (`packages/shared/src/lib/hub.ts`). O que muda entre elas é só o **canal**:

| Extensão | Canal (`extension`) | Plataforma | Nome no manifest (enviado no handshake) |
|---|---|---|---|
| iFood | `undercut-ifood` | `ifood` | Undercut · Otimizador iFood |
| Cardápio Web | `undercut-cardapioweb` | `cardapioweb` | Undercut · Otimizador Cardápio Web |
| Anota AI | `undercut-anotaai` | `anotaai` | Undercut · Otimizador Anota AI |

## O que o servidor precisa fazer
1. `POST /api/v1/extension-auth/login` aceita `extension` ∈ os 3 canais acima e devolve a chave já amarrada a esse canal.
2. `GET /api/v1/me` devolve `extension` (o canal da chave) e `platform`. A extensão **apaga a chave** se `extension` não for o canal dela (“chave de outra extensão”).
3. `POST /api/v1/extensions/handshake` aceita `manifest_name` dos 3 nomes (hoje só o do iFood costuma estar cadastrado).
4. Tela **Extensões** no painel lista os 3 canais (o card “Conectada agora” vem do handshake/heartbeat).
5. Rotas já usadas pelas extensões (mesmas para as 3): `clients/ensure`, `analysis`, `optimizations`, `clients`, importação de cardápio, pendências. Escopos da chave: `clientes:ler`, `catalogo:ler`, `catalogo:escrever`.

## Como conferir (sem mexer no servidor)
Abra o painel da extensão → aba **Produtos** → cartão **Conexão com o Undercut** (botão ↻). Ele mostra, passo a passo:
chave salva → servidor respondeu → chave aceita → **integração da plataforma liberada** → handshake.
Se o passo “Integração … liberada” falhar, a mensagem diz o canal recebido e o esperado — é exatamente o item 1/2/3 acima que falta.

> Não tive acesso ao código nem ao banco do servidor real nesta sessão; este arquivo descreve o contrato que as extensões esperam.
