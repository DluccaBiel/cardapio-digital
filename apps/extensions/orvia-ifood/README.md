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

## Conectar com seu usuário (recomendado)

Nas opções da extensão (clique no ícone dela), entre com **o mesmo e-mail e senha do Orvia**. O servidor confere o seu papel no workspace (dono, coordenador ou editor) e entrega um acesso próprio para a extensão, válido por 365 dias. A senha não fica salva em lugar nenhum. Se você entrar de novo no mesmo navegador, o acesso anterior desse navegador é revogado. Enquanto o portal do iFood estiver aberto, a extensão avisa o Orvia a cada 2 minutos, e o painel mostra "Conectada agora".

## Aplicação automática (aprende com você)

A API interna do portal iFood não é pública, então a extensão **aprende por exemplo**:
1. Abra o cardápio no portal, para a extensão ler os produtos.
2. Edite **um** produto no portal, do jeito normal (por exemplo, mude o preço, a descrição ou pause, e salve). A extensão observa a requisição que o próprio portal fez e guarda um "molde": endereço, formato e o campo exato. Cabeçalhos e tokens **não** entram no molde.
3. Na aba **Pendências**, use **Simular** para ver o antes → depois sem enviar nada, e depois **Aplicar automaticamente**. Para cada item, a extensão:
   - lê o item atual;
   - altera só os campos aprendidos;
   - confere que nenhum outro campo mudaria;
   - envia usando a sessão da própria aba;
   - relê para confirmar e marca como sincronizado no Orvia.

   O ritmo é de 900 ms entre itens. Ela para no primeiro erro real.
4. **Desfazer último lote** devolve os valores anteriores no iFood.
5. Opcional: com **Aplicar sozinho ao abrir o portal** ligado, a extensão aplica o que já sabe assim que você abre o portal.

Itens **novos** (produto ou combo que ainda não existe no iFood) continuam com criação assistida.

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

## Limites desta versão (0.3.0)

- A escrita automática cobre **atualização** de preço, descrição, nome e pausar/ativar de itens existentes, depois que cada campo for ensinado uma vez. **Criar** produtos ou combos no iFood ainda é assistido.
- Se o portal mudar o formato de salvamento, a conferência falha e nada é enviado. Nesse caso, ensine de novo, editando 1 item.
- Fotos não são sincronizadas (o pipeline de imagens é o Passo 7 do roadmap).
- "Ler da tela" é um fallback limitado: não traz categorias, complementos nem IDs do iFood, então os itens importados assim ficam pendentes.

## Desenvolvimento

```bash
npm run verify        # typecheck + testes (vitest) + build
npm run build         # dist/{page-hook,content,background,options}.js
# E2E no Chromium real contra o hub LOCAL (portal iFood SIMULADO com fixture fictícia):
LOCAL_API_URL=... LOCAL_SERVICE_ROLE_KEY=... node scripts/e2e.mjs   # esperado 29/29
```

Estrutura: `src/core/*` (normalizador, regras e combos, puros), `src/lib/*` (cliente do hub e conversões, puros e testados), `src/page/hook.ts` (MAIN world), `src/content/*` (painel), `src/background/worker.ts`, `src/options/*`.
