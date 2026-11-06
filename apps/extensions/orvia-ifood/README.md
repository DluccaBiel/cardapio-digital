# Orvia · Otimizador iFood (extensão Chrome MV3)

Lê o cardápio no **Portal do Parceiro iFood**, envia para o **Orvia** e guia a aplicação, no iFood, de combos e edições feitas no painel.

```text
 Portal iFood ──(leitura passiva)──► extensão ──(X-API-Key, If-Match)──► Orvia /api/v1
      ▲                                  │                                    │
      └──── você aplica (assistido) ◄────┴──── Pendências (antes → depois) ◄──┘
```

## Instalar e conectar (uma vez por navegador)

1. `npm install && npm run build` nesta pasta (gera `dist/`).
2. No Chrome, abra `chrome://extensions`, ative o **Modo do desenvolvedor**, clique em **Carregar sem compactação** e selecione esta pasta.
3. **Conectar com um clique:** com login feito no Orvia, abra **Extensões** e clique em **Conectar extensão**. Também dá para começar pelas opções da extensão, em "Conectar automaticamente".
   - O painel gera uma chave com escopos mínimos e validade de 365 dias e a entrega direto à extensão pela ponte `hub-bridge`, um content script que só roda em `/a/*/extensoes` do hub.
   - A chave fica salva em `chrome.storage.local`. Ninguém vê nem cola a chave, e ela não aparece na página.
   - Para desconectar: no Orvia, revogue a chave "Conexão automática · data" em Extensões; ou, nas opções da extensão, clique em **Desconectar**.
4. Conexão manual, como alternativa: em **Extensões → Gerar chave**, copie a chave e cole nas opções.

## Fluxo de uso

1. **Conferência:** abra o cardápio da loja no portal do iFood. A extensão lê sozinha as respostas que o próprio portal carrega. O botão azul **O** ganha um ponto verde quando há leitura.
2. **Enviar para o Orvia:** escolha o cliente, que é sugerido pelo ID ou pelo nome da loja, e clique em enviar. Regras:
   - **Trava de loja:** se o cliente já está vinculado a outra loja do iFood, a importação é recusada (`merchant_mismatch`).
   - Nada é apagado no Orvia. Produtos editados no Orvia e ainda não aplicados no iFood são **mantidos** e aparecem em Pendências.
   - If-Match com o ETag do catálogo: se alguém editar o cardápio no Orvia durante a leitura, a importação é recusada (409) e você tenta de novo.
3. **Aplicação (Pendências):** a lista mostra **antes → depois** de cada produto ou combo alterado no Orvia, com botão "copiar". Aplique no portal e clique em **Apliquei no iFood ✓**. Para itens novos, informe o ID do iFood se tiver; sem ele, o vínculo é feito pelo nome na próxima importação.
4. **Pausa:** combos criados pela extensão ou pela análise **nascem pausados** no Orvia. Ative no painel quando revisar.
5. **Reversão:** a extensão não altera o iFood sozinha, então não existe escrita automática a desfazer. No Orvia, toda mudança fica no `audit_log`. Se a confirmação chegar depois de o item mudar no Orvia, ela é recusada (409) e o item continua pendente.

## Segurança

- A chave fica só em `chrome.storage.local` e só o service worker a usa, no header `X-API-Key`. Ela nunca vai para o portal nem para o content script.
- O page hook (`src/page/hook.ts`) só **lê** corpos JSON que já são carregados pelo portal. Ele não lê headers, cookies ou tokens e não faz chamadas próprias ao iFood.
- O painel roda em **Shadow DOM fechado**, então o JS do portal não lê os nomes dos clientes nem as pendências. Tudo é renderizado com `textContent`, nunca `innerHTML` com dados.
- `host_permissions`: o portal do iFood (necessário para ler o cardápio) e o hub de produção (`orvia-gestao.vercel.app`). Previews `*.vercel.app` e `localhost` são **permissões opcionais**, pedidas na tela de opções. Não há `<all_urls>` nem `tabs`.

## Limites desta versão (0.2.0)

- **Sem escrita automática no iFood.** Os endpoints internos do portal não são oficiais nem documentados. Automatizar exige mapeá-los (descoberta sanitizada) e validar com cuidado. Até lá, a aplicação é assistida.
- Fotos não são sincronizadas (o pipeline de imagens é o Passo 7 do roadmap).
- "Ler da tela" é um fallback limitado: não traz categorias, complementos nem IDs do iFood, então os itens importados assim ficam pendentes.

## Desenvolvimento

```bash
npm run verify        # typecheck + testes (vitest) + build
npm run build         # dist/{page-hook,content,background,options}.js
# E2E no Chromium real contra o hub LOCAL (portal iFood SIMULADO com fixture fictícia):
LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node scripts/e2e.mjs   # esperado 15/15
```

Estrutura: `src/core/*` (normalizador, regras e combos, puros), `src/lib/*` (cliente do hub e conversões, puros e testados), `src/page/hook.ts` (MAIN world), `src/content/*` (painel), `src/background/worker.ts`, `src/options/*`.
