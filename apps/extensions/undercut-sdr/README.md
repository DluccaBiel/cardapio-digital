# Undercut · SDR WhatsApp (extensão Chrome)

Painel do SDR do Undercut **dentro do WhatsApp Web**. A extensão é o "cockpit"; quem envia e recebe
mensagens é o **robô local** (`npm run worker`, ver `apps/whatsapp-worker/README.md`), e quem decide
regras, cadências e IA é o **menu SDR** do Undercut.

```text
Menu SDR (Undercut)  ──regras, cadências, IA──▶  Supabase  ◀── robô no PC (envia/recebe, 24h)
                                                     ▲
WhatsApp Web + esta extensão ──API /api/v1/sdr───────┘   (ficha, funil, notas, aprovações)
```

## Instalar (modo desenvolvedor)

1. Chrome → `chrome://extensions` → ative **Modo do desenvolvedor**.
2. **Carregar sem compactação** → selecione a pasta `apps/extensions/undercut-sdr`.
3. Clique no ícone do Undercut na barra → entre com seu e-mail e senha do Undercut.
   A senha não fica salva: a extensão recebe uma chave própria, só com acesso ao SDR (`sdr:ler`, `sdr:escrever`).
4. Abra `https://web.whatsapp.com` — o painel aparece à direita (aba vermelha "UNDERCUT SDR" mostra/oculta).

## O que o painel faz

| Na conversa aberta | Como |
|---|---|
| **Ficha do lead** | nome, telefone, cidade, categoria; alerta quando o lead pediu atendimento humano |
| **Funil** | troque a etapa no seletor (para a cadência atual e inicia a da nova etapa) e o **valor previsto** |
| **Atalhos `#`** | digite sozinho no campo e aperte Enter: `#reuniao`, `#proposta`, `#qualificado`, `#cliente`, `#perdido`… — muda a etapa e **não é enviado** |
| **Respostas rápidas** | por etapa, com `{nome}` preenchido; o texto vai para o campo — **você** aperta Enter |
| **IA** | sugestões aguardando aprovação: editar, enviar pelo robô, usar no campo ou descartar; **Assumir conversa** pausa a IA neste lead |
| **Fila do robô** | 1º contato, follow-ups e respostas agendadas (com cancelar) |
| **Notas e lembretes** | nota com data/hora de lembrete; lembretes vencidos aparecem no ícone |
| **Opt-out** | marca o lead para nunca mais receber mensagens |
| **Não é lead?** | "Adicionar ao SDR" (marque "ele me procurou" para não receber o 1º contato automático) |

O ícone da extensão mostra um contador: leads esperando você + respostas da IA para aprovar + lembretes vencidos.
O popup lista cada um e o status do robô.

## Regras de segurança

- A automação **só fala com leads do SDR**. Grupos e contatos pessoais são ignorados (pelo robô e pelo painel).
- O painel **nunca envia sozinho**: insere texto no campo ou pede ao robô (que aplica horário, intervalo e limites).
- Se você responde um lead pelo celular/WhatsApp Web, a IA **sai de cena** naquele lead automaticamente.
- Telefone: lido do id das mensagens da conversa. Em contatos salvos em que o WhatsApp esconde o número,
  o painel pede para você informar — nada é adivinhado.
- `host_permissions` só dos domínios do Undercut; o WhatsApp Web é acessado apenas pelo content script.

## Testes (local)

`node scripts/e2e-sdr-extension.mjs` — carrega a extensão num Chromium de teste com um WhatsApp Web
**simulado** e o hub/Supabase locais (17 verificações: login, ficha, funil, atalho `#`, respostas rápidas,
nota, aprovação da IA, assumir conversa, contador no ícone).
