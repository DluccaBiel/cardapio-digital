# Robô de disparos WhatsApp (local)

Processo Node que roda **no seu computador** e faz três coisas para o menu **Disparos** do painel:

1. **Conexão por QR code** (não oficial, igual ao WhatsApp Web — biblioteca Baileys): gera o QR, mostra no painel, vincula e informa o status real da sincronização.
2. **Agente de prospecção**: executa as pesquisas pedidas no painel (empresas food com telefone por cidade, dados abertos do OpenStreetMap — sem chave do Google). Roda aqui porque os servidores públicos de mapas podem levar minutos, e a Vercel corta em 60 s.
3. **Envio agendado**: respeita dias da semana, janela de horário (America/Sao_Paulo), intervalo aleatório entre envios e limite diário do número; simula "digitando…"; pula números sem WhatsApp; respostas "SAIR/PARAR" viram opt-out automático (LGPD).

```text
 Painel (Vercel)  ──grava pedido──▶  Supabase  ◀──lê/escreve (service role)──  Robô (seu PC)  ──▶ WhatsApp
   QR/status ◀────────────────────── whatsapp_sessions, prospect_searches,                │
                                     prospect_leads, broadcast_*                          └─▶ OpenStreetMap
```

O robô só faz conexões de **saída** (Supabase, WhatsApp, mapas, Undercut). Nada fica exposto na internet.

### SDR no WhatsApp

Além dos Disparos, o robô executa o **SDR** (menu SDR → SDR WhatsApp e a extensão `apps/extensions/undercut-sdr`):
cadências de follow-up por etapa (só na janela de envio, com limite de novos contatos/dia), respostas 24h,
prospecção contínua por cidades e a **IA** — quando um lead escreve, o robô espera 20 s e pede a resposta ao
Undercut (`HUB_URL`, padrão `https://undercuthub.vercel.app`), que roda a IA e o Google Agenda no servidor.
Para isso o robô cria a própria chave de API (só `sdr:*`) a cada vez que liga e revoga a anterior.

## Instalação (uma vez)

Requer Node 22.18+ (o robô importa `lib/sdr/providers/osm.ts` direto).

```bash
npm run worker:install
```

Gere o `apps/whatsapp-worker/.env` do projeto Supabase vinculado (AnjimBanco) — usa o login da Supabase CLI
e grava a chave sem exibi-la:

```bash
npm run worker:setup
```

(Ou crie à mão a partir de `.env.example`.) **Nunca commite esse arquivo** — a chave service role dá acesso total ao banco.
`UNDERCUT_WORKSPACE` é o slug do workspace (parte da URL `/a/<slug>/...`); pode ficar vazio se o banco tiver um só.

## Uso

```bash
npm run worker
```

Deixe a janela aberta. No painel → **Disparos**:

1. **Conectar WhatsApp** → o QR aparece em segundos → no celular: *Configurações → Aparelhos conectados → Conectar aparelho*.
   Status: *Gerando QR → Vinculando → Vinculado · sincronizando (barra) → Pronto para enviar*.
2. **Público**: digite a cidade (+ UF) e clique em *Buscar empresas novas*. As empresas novas (que não estão na base nem são clientes) já entram selecionadas.
3. **Mensagem e agendamento**: texto com `{nome}`, dias, horário, intervalo entre envios e limite diário → *Agendar disparo*.

A sessão fica em `apps/whatsapp-worker/auth/` (gitignored). Fechar o robô **não** desvincula: ao abrir de novo, reconecta sem QR.
*Desvincular* no painel (ou no celular) apaga a sessão.

## Para não perder o número

- Conexão não oficial viola os termos do WhatsApp — use um número que você pode arriscar, de preferência já "aquecido" (com conversas reais).
- Comece com **20–40 envios/dia** e intervalo **1–3 min** (padrão). Aumente aos poucos.
- Personalize com `{nome}`, evite links no primeiro contato e sempre ofereça "responda SAIR".
- Após 5 falhas seguidas o disparo é **pausado** automaticamente.

## Problemas comuns

| Sintoma no painel | Causa / solução |
|---|---|
| "Robô desligado" | `npm run worker` não está rodando (ou sem internet). |
| QR não aparece | Veja o terminal do robô; confira o `.env` e se a migration `20261118120000_whatsapp_disparos.sql` foi aplicada. |
| "O QR code expirou" | Ninguém leu em ~1 min. Clique em *Conectar WhatsApp* de novo. |
| Pesquisa demora | Servidores gratuitos de mapas oscilam; o robô tenta por até 5 min, alternando espelhos. |
| Disparo não sai | Fora do dia/horário configurado, limite diário atingido ou WhatsApp ainda sincronizando. |
