# Robô do WhatsApp 24 h (Disparos + Relatórios nos grupos)

A conexão por QR code (não oficial, tipo WhatsApp Web) precisa de **um processo ligado o tempo todo**.
A Vercel não consegue (cada requisição morre em segundos), por isso existe o robô (`apps/whatsapp-worker`).
Ele é quem: mostra o QR e o status real no painel, envia os Disparos, lê os grupos e **envia os Relatórios agendados**.

Dois jeitos de rodar — o painel (Disparos) mostra **Robô online/desligado** em tempo real (batimento a cada ~10 s):

## A) No seu computador (teste)
`npm run worker:install` → `npm run worker:setup` → `npm run worker` (deixe aberto). Se o PC desligar, nada é enviado.

## B) Em servidor, 24 h (recomendado para relatórios agendados)
Qualquer serviço que rode Docker com **volume persistente** (Railway, Fly.io, Render, VPS). Use o `Dockerfile.worker` da raiz.

1. Crie um serviço a partir do repositório com **Dockerfile path = `Dockerfile.worker`**.
2. Variáveis de ambiente:
   - `SUPABASE_URL` — URL do projeto Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` — chave *service role* (só no servidor; nunca no navegador/commit)
   - `UNDERCUT_WORKSPACE` — slug do workspace (parte da URL `/a/<slug>/…`)
   - `HUB_URL` — `https://undercuthub.vercel.app`
3. **Volume** montado em `/data` (guarda o login do WhatsApp; sem ele o QR seria pedido a cada reinício).
4. **Uma única instância** (não escale para 2: dois robôs disputariam o mesmo número e poderiam duplicar mensagens).
5. Abra **Disparos → Conectar WhatsApp**, leia o QR no celular. Pronto: pode fechar o computador.

> Use um número que você pode arriscar. Conexão não oficial viola os termos do WhatsApp; comece com 20–40 envios/dia.

## Ligar sozinho ao clicar em "Iniciar Robô & Disparos"
Com o robô em servidor, o botão do painel o liga sem você abrir terminal. Na Vercel (Production) configure:

- `WORKER_START_URL` — endereço que liga o robô. Fly.io: `https://api.machines.dev/v1/apps/<app>/machines/<id>/start`
- `WORKER_START_TOKEN` — token da Fly (`fly tokens create deploy -a <app>`), enviado como `Bearer`.

Fluxo: clicar em disparar → o painel vê que o robô está desligado → chama essa URL → espera ele bater ponto (até ~8 s) →
ativa a campanha. O robô reconecta o WhatsApp sozinho (a sessão fica no volume `/data`, sem novo QR).
Sem a URL, na Vercel o painel só avisa para ligar manualmente; rodando `npm run dev/start` no PC ele inicia o processo local.
Alternativa sem API: deixe o serviço sempre ligado (Railway/Render/VPS) — aí nada precisa ser ativado.
