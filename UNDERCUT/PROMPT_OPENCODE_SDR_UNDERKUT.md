# PROMPT PARA O OPENCODE — Módulo "SDR Underkut" (agente de prospecção + CRM + atendimento IA com BANT)

> Cole este arquivo inteiro no OpenCode (Antigravity). Ele foi escrito para ser executado por fases.
> Não pule a Fase 0. Ao fim de cada fase, pare, rode lint/typecheck/testes e me mostre o diff resumido.

---

## 0. CONTEXTO DO SISTEMA (leia antes de tudo)

- Monorepo **Next.js 14 (App Router) + Supabase (PostgreSQL 15+)**. Auth: Supabase Auth + chaves de API com escopos (hash em `key_hash`).
- O sistema é um **hub de extensões** (iFood, Cardápio Web, Anota AI, FlyTo) com rotas `/a/{workspace}/...`.
- Marca Undercut: preto `#0B0B0C`, vermelho `#D7141F`/`#B5121B`; fontes Anton / Archivo / JetBrains Mono; estilo "telemetry", tabelas densas.
- **Regras obrigatórias (AGENTS.md) — valem para TODO código deste módulo:**
  - RLS ativo em toda tabela nova. Nunca desativar.
  - `service_role` só no servidor. Nada sensível em `NEXT_PUBLIC_*`.
  - `If-Match` obrigatório em toda escrita pública → `428` se faltar, `412` se versão divergente.
  - Zod em toda rota (entrada e saída).
  - Queries parametrizadas. Zero SQL concatenado.
  - Sem `dangerouslySetInnerHTML` sem sanitização (o markdown da IA passa por sanitizador).
  - Webhooks: só HTTPS, proteção SSRF, assinatura HMAC-SHA256 verificada.
  - Segredos nunca em log. `audit_log` só ator/ação/entidade.
  - LGPD: campos pessoais marcados `[PII/LGPD]`, retenção definida, opt-out respeitado.

---

## FASE 0 — AUDITORIA (obrigatória, não escreva código novo ainda)

Recebi um resumo dizendo que "tudo está pronto". **Não confie nele. Verifique no código** e me entregue uma tabela `item | existe? | arquivo | problema encontrado`:

1. Existem de fato: `supabase/migrations/20261116152908_add_client_niche_website.sql`, `app/api/v1/clients/{search,prospect,research}/route.ts`, `app/a/[ws]/clientes-prospecao/page.tsx`, `app/a/[ws]/disparos/page.tsx`?
2. A migração nova segue a numeração `0001…0010`? Se não, padronize como `0011_...` (ou confirme que o CLI do Supabase aceita os dois formatos sem quebrar a ordem).
3. A coluna `website` já existia antes? (O resumo lista `website` como existente E como nova.) Garanta `ADD COLUMN IF NOT EXISTS`.
4. **Erro conceitual a corrigir:** o resumo trata `monthly_fee` como "faturamento". `monthly_fee` é o que o cliente paga para a agência, **não** o faturamento da empresa. Não reutilize esse campo para faturamento de prospect.
5. **Erro de escopo a corrigir:** `/clients/search` e `/clients/prospect` usam `catalogo:ler` mas devolvem telefone/e-mail (PII), enquanto `/clients` (sem PII) exige `clientes:ler`. PII não pode sair com escopo de catálogo.
6. O nicho está como `'food' | 'health'`. O nicho desejado é **food e estética**. Não force estética dentro de `health`.
7. **Prospects não são clientes.** Não misture leads frios na tabela `clients`. Este módulo cria tabelas próprias (Fase 1). `clients` só recebe o lead quando ele vira cliente (status "Ganho").
8. Rode `npm run lint`, `npm run typecheck` e os testes existentes; reporte o que já falha antes das minhas mudanças.

Só siga para a Fase 1 depois de me mostrar a auditoria.

---

## VISÃO GERAL DO QUE SERÁ CONSTRUÍDO

Um **SDR completo dentro do hub**, em 5 blocos:

```
[1. DESCOBERTA]  Receita Federal (dados abertos CNPJ por CNAE+cidade)  +  Google Places (busca por nicho/cidade)
        │
[2. ENRIQUECIMENTO]  CNPJ → razão social, porte, capital social, Simples/MEI, sócios, telefone/e-mail cadastrais
                     Places → telefone comercial, site, nota, nº de avaliações
                     Site/Instagram públicos → sinais (tem cardápio online? agenda online? anuncia?)
                     → FAIXA DE FATURAMENTO ESTIMADA (com fonte e confiança)  → ICP SCORE 0–100
        │
[3. CRM DE PROSPECÇÃO]  Kanban + tabela densa + timeline por lead  (/a/{ws}/sdr)
        │
[4. CADÊNCIA MULTICANAL]  e-mail + WhatsApp (API oficial ou wa.me assistido) + ligação assistida pela extensão
        │
[5. AGENTE IA DE PRIMEIRO ATENDIMENTO]  responde quem respondeu, qualifica em BANT, agenda reunião, passa para humano
```

A **extensão Chrome** é a "mão" do SDR no navegador: captura leads de Google Maps/Instagram/sites, mostra o card do lead no WhatsApp Web, faz click-to-call e registra tudo no CRM.

---

## DECISÕES DE ARQUITETURA (já tomadas — siga-as)

| Tema | Decisão | Motivo |
|---|---|---|
| Fonte de empresas | **Receita Federal dados abertos (CNPJ)** como base + **BrasilAPI / CNPJá** para consulta pontual por CNPJ | Dado público, cobre CNAE, porte, capital, sócios, contato cadastral. Não existe API REST oficial gratuita da Receita; os caminhos são dados abertos, Serpro (pago) ou serviços terceiros. |
| Telefone/site comercial | **Google Places API (New) – Text Search** com field mask mínimo | Telefone e site ficam no SKU Enterprise (mais caro). Pedir só os campos necessários. Termos do Google restringem armazenamento: guardar `place_id` e dados derivados; reconsultar em vez de cachear indefinidamente. Deixe isso documentado no código. |
| Faturamento | **Nunca afirmar faturamento real.** Gerar `revenue_band` estimada + `revenue_confidence` + `revenue_signals[]` | Faturamento não é público. Estimar por porte (MEI/ME/EPP/Demais), Simples, capital social, nº de filiais, nº de avaliações, presença em iFood/agenda online. |
| WhatsApp automatizado | **WhatsApp Cloud API oficial** para envio por template e para o agente IA. **Proibido** automatizar cliques/envio no WhatsApp Web pela extensão | Automação do WhatsApp Web viola os termos e derruba o número. Na extensão, envio no WhatsApp Web é sempre **o humano clicando "Enviar"**. |
| Agente IA no WhatsApp | Agente **de vendas/atendimento da própria empresa** (permitido) — nunca um "assistente de uso geral" | Política da Meta de 2026 proíbe chatbots de uso geral, mas permite IA para atendimento e vendas do próprio negócio. |
| Ligações | **Ligação assistida** (click-to-call + roteiro + registro). Sem robocall/discador automático com voz IA em lista fria | Anatel pune "ligações mudas"/abusivas; status do 0303 está em disputa. IA de voz só em fase futura e para quem pediu retorno. |
| E-mail frio | Domínio secundário dedicado, SPF/DKIM/DMARC, aquecimento, limite diário por caixa, link de descadastro em 1 clique | Entregabilidade e LGPD. |
| Base legal LGPD | **Legítimo interesse B2B** com LIA registrado, transparência na 1ª mensagem e opt-out global | Contato profissional com empresas é defensável por legítimo interesse, com finalidade clara e opt-out. |
| LLM | Claude via API (`ANTHROPIC_API_KEY` só no servidor), tool use, saída estruturada validada por Zod | Já integrado em `lib/api/research.ts`. |

---

## FASE 1 — BANCO DE DADOS (migração `0011_sdr_module.sql` ou equivalente)

Crie as tabelas abaixo. **Todas** com `workspace_id uuid not null`, `created_at`, `updated_at`, `version int` (para `If-Match`), RLS por `workspace_id` via função de membership já existente, índices em `(workspace_id, ...)`, FKs compostas `(workspace_id, id)` seguindo o padrão da migração `0003_tenant_consistency.sql`.

```
sdr_niches            -- enum lógico: 'food' | 'estetica'  (tabela ou CHECK; não reutilizar 'health')

leads                 -- a EMPRESA prospectada
  id, workspace_id
  niche                     text CHECK in ('food','estetica')
  cnpj                      text  (14 dígitos, único por workspace quando presente)
  razao_social, nome_fantasia
  cnae_principal, cnaes_secundarios text[]
  porte                     text  ('MEI','ME','EPP','DEMAIS', null)
  opcao_simples, opcao_mei  boolean
  capital_social            numeric
  data_abertura             date
  situacao_cadastral        text  (só prospectar 'ATIVA')
  uf, municipio, bairro, cep, logradouro
  google_place_id, google_rating, google_reviews_count
  website, instagram_handle, ifood_url, agenda_online_url
  revenue_band              text  ('ate_81k','81k_360k','360k_1m','1m_4_8m','acima_4_8m')
  revenue_confidence        text  ('baixa','media','alta')
  revenue_signals           jsonb (lista de sinais usados + fonte)
  icp_score                 int 0..100
  icp_breakdown             jsonb
  stage                     text  (ver pipeline abaixo)
  owner_user_id             uuid  (SDR humano responsável)
  lost_reason               text
  source                    text  ('receita_dados_abertos','google_places','extensao_maps','extensao_instagram','inbound_form','manual')
  lgpd_basis                text default 'legitimo_interesse'
  archived_at               timestamptz

lead_contacts         -- PESSOAS/CANAIS do lead  [PII/LGPD]
  id, workspace_id, lead_id
  kind        ('telefone','whatsapp','email')
  value       text
  label       ('cadastral_receita','comercial_google','site','instagram','informado_pelo_lead')
  person_name text null   -- só nome e papel (ex.: sócio-administrador). NUNCA CPF.
  role        text null
  is_primary  boolean
  verified_at timestamptz null
  source_url  text null    -- origem do dado (exigência LGPD: saber de onde veio)

lead_enrichment_runs  -- histórico de cada enriquecimento (provider, status, custo estimado, payload resumido sem segredos)

suppression_list      -- OPT-OUT global por workspace  [PII/LGPD]
  value_hash (sha256 do telefone/e-mail normalizado), kind, reason, created_at
  -> checado ANTES de qualquer envio/ligação. Trigger impede cadência de enfileirar contato suprimido.

cadences, cadence_steps   -- definição: passo, dia relativo, canal, template_id, condição de saída
lead_cadence_enrollments  -- lead inscrito em qual cadência, passo atual, next_run_at, status
message_templates         -- por nicho e canal; para WhatsApp guarda nome/idioma/categoria do template aprovado na Meta
activities                -- timeline única: email_enviado, email_aberto, resposta, whatsapp_enviado, ligacao, nota, mudanca_stage, bant_update, reuniao_marcada
conversations, conversation_messages  -- conversas do agente IA (canal, direção, conteúdo, ai_generated bool, tokens)
bant_assessments          -- budget/authority/need/timing (0–3 cada), evidências (trechos da conversa), score total, atualizado_por ('ia'|'humano')
meetings                  -- lead_id, start_at, end_at, calendar_event_id, meet_url, status ('marcada','realizada','no_show','cancelada')
lia_records               -- registro do Teste de Legítimo Interesse por workspace (texto + data + responsável)
```

**Pipeline (`leads.stage`)**:
`novo → enriquecido → qualificado_icp → em_cadencia → respondeu → em_qualificacao_ia → sql (BANT ok) → reuniao_marcada → ganho | perdido | descartado | opt_out`

Regras via trigger/função:
- `opt_out` insere contatos na `suppression_list`, encerra inscrições de cadência e bloqueia novos envios.
- `ganho` cria/garante registro em `clients` (reaproveite a lógica de `/clients/ensure`).
- Retenção: leads `descartado`/`perdido` sem atividade há 6 meses → anonimizar `lead_contacts` por job (pg_cron).
- Pare e me mostre a migração antes de aplicar.

---

## FASE 2 — DESCOBERTA E ENRIQUECIMENTO (o "agente pesquisador")

Crie `lib/sdr/` com módulos isolados e testáveis:

```
lib/sdr/providers/receita.ts      -- consulta à base de dados abertos importada (ver abaixo) por CNAE+UF+município
lib/sdr/providers/cnpj-lookup.ts  -- BrasilAPI (primário) → CNPJá → ReceitaWS (fallback), com rate limit e retry exponencial
lib/sdr/providers/places.ts       -- Google Places API (New) Text Search, field mask mínimo, paginação, custo estimado por chamada
lib/sdr/providers/public-web.ts   -- lê SOMENTE a home/página pública do site do lead (respeitar robots.txt, timeout 8s, 1 req/s por domínio, SSRF guard: bloquear IP privado/localhost)
lib/sdr/match.ts                  -- casa "nome do Google" ↔ CNPJ (nome fantasia + município + CEP, fuzzy com score). <0.8 → marcar "precisa confirmar" e mostrar ao humano
lib/sdr/revenue.ts                -- estimativa de faixa (regras abaixo)
lib/sdr/icp.ts                    -- score ICP (regras abaixo)
lib/sdr/dedupe.ts                 -- dedupe por cnpj, place_id, telefone normalizado E.164, domínio do site
```

**Importação da base da Receita (dados abertos):** script `scripts/import-cnpj-open-data.ts` que baixa os arquivos mensais de Estabelecimentos/Empresas/Simples, filtra **apenas** os CNAEs do nicho + `situacao = ATIVA` + UFs configuradas, e carrega numa tabela `cnpj_cache` (sem RLS de workspace — é dado público compartilhado, só leitura, acessada só pelo servidor). Rode isso como job, não em request.

**CNAEs iniciais** (valide cada código na tabela oficial CONCLA/IBGE antes de usar e deixe configurável):
- Food: 5611-2/01 (restaurantes), 5611-2/03 (lanchonetes/casas de chá/sucos), 5611-2/04 e 5611-2/05 (bares), 5620-1/04 (alimentos preparados p/ consumo domiciliar — delivery/marmitaria), 1091-1/02 e 4721-1/02 (padarias/confeitarias).
- Estética: 9602-5/02 (estética e cuidados com a beleza), 9602-5/01 (cabeleireiros/manicure), e avaliar clínicas de estética registradas em CNAEs de saúde (marcar como "verificar" — não prospectar atividade médica sem revisão minha).

**Faixa de faturamento estimada (`revenue.ts`)** — regras determinísticas, explicáveis, sem IA inventando número:
- MEI → `ate_81k` (confiança alta, fonte: enquadramento MEI).
- ME → `81k_360k` (média). EPP → `360k_1m` ou `1m_4_8m` conforme sinais (média/baixa). Demais → `acima_4_8m` (média).
- Ajustes por sinais: nº de filiais (mesmo CNPJ raiz), capital social, `google_reviews_count`, presença em iFood/agenda online, anos de operação.
- Sempre gravar `revenue_signals` com cada sinal + fonte. **Na UI escrever "Faixa estimada", nunca "Faturamento".**
- Confirme os limites atuais de MEI/ME/EPP antes de codar (deixe em constante configurável).

**ICP score (`icp.ts`)** — 0 a 100, pesos configuráveis por workspace:
- Fit de nicho/CNAE (25), faixa estimada no alvo (20), tem canal digital ativo (site/IG/iFood/agenda) (15), sinal de dor (nota < 4.3, poucas avaliações, sem site, cardápio desatualizado, sem agenda online) (20), tem telefone/WhatsApp comercial válido (10), localização no raio alvo (10).
- `icp_score >= 60` → `qualificado_icp`.

**Rotas** (Zod + escopos novos `leads:ler`, `leads:escrever`, `sdr:executar`; rate limit por chave):
- `POST /api/v1/sdr/discover` `{ niche, uf, municipio, bairro?, limit≤200, sources: ['receita','places'] }` → enfileira job, devolve `job_id`.
- `GET  /api/v1/sdr/jobs/{id}` → progresso.
- `POST /api/v1/sdr/leads/{id}/enrich` (If-Match) → reenriquece um lead.
- `POST /api/v1/sdr/leads/capture` (usado pela extensão) `{ source, url, name, phone?, website?, instagram?, place_id? }` → dedupe + enriquecimento assíncrono.
- `GET  /api/v1/sdr/leads?niche&stage&min_score&uf&municipio&has_whatsapp&cursor` → lista paginada.
- Corrija os escopos das rotas antigas `/clients/search` e `/clients/prospect` (ver Fase 0).

Testes: unit para `match`, `revenue`, `icp`, `dedupe` com fixtures; mocks dos providers.

---

## FASE 3 — CRM DE PROSPECÇÃO (`/a/{ws}/sdr`)

Telas no padrão visual Undercut (tabelas densas, JetBrains Mono para dados):

1. **`/a/{ws}/sdr`** — Kanban por `stage` + alternância para **tabela densa**. Colunas: empresa, nicho, cidade/bairro, faixa estimada (com tooltip das fontes), ICP score (barra), canais disponíveis (ícones), último toque, próximo passo, dono.
   Filtros: nicho (Food/Estética), stage, score mínimo, cidade, "sem site", "nota < 4.3", "tem WhatsApp".
   Ações em lote: inscrever em cadência, atribuir dono, descartar, exportar CSV (respeitando suppression).
2. **`/a/{ws}/sdr/descobrir`** — formulário de descoberta (nicho, UF, cidade, bairro, fontes, limite) + progresso do job + prévia com dedupe antes de importar.
3. **`/a/{ws}/sdr/lead/{id}`** — ficha: dados Receita, dados Google, sinais, faixa estimada explicada, ICP breakdown, contatos (com origem de cada um), **timeline** de atividades, painel BANT, conversas da IA, reuniões, botão "Pesquisar com IA" (reaproveitar `/api/v1/clients/research` adaptado para `lead_id`), botão "Opt-out".
4. **`/a/{ws}/sdr/cadencias`** — editor de cadências e templates por nicho/canal.
5. **`/a/{ws}/sdr/conversas`** — inbox das conversas do agente IA, com botão "Assumir" (humano assume e a IA para).
6. **`/a/{ws}/sdr/metricas`** — funil: descobertos → qualificados ICP → contatados → responderam → SQL → reuniões → ganhos; taxa de resposta por canal/template/nicho; reuniões por 100 contatos; no-show.
7. **Migrar** `/a/{ws}/disparos` e `/a/{ws}/clientes-prospecao` para dentro do módulo SDR (redirecionar rotas antigas) — não manter duas telas fazendo a mesma coisa.

---

## FASE 4 — CADÊNCIA MULTICANAL

Motor em `lib/sdr/cadence/`: job a cada 5 min (pg_cron → Edge Function ou rota interna autenticada) processa `lead_cadence_enrollments` com `next_run_at <= now()`.

Regras do motor:
- Antes de cada passo: checar `suppression_list`, `stage` (saiu se respondeu/opt-out/reunião), janela de horário **seg–sex 9h–18h no fuso do lead**, limite diário por caixa de e-mail e por número WhatsApp.
- Resposta em qualquer canal → **pausa a cadência** e move para `respondeu` → aciona o agente IA (Fase 5).
- Passo de **ligação** e passo de **WhatsApp via wa.me** não são automáticos: viram **tarefa** na fila do SDR humano (aparecem na extensão e no CRM).

**Cadência padrão "Food – 14 dias"** (criar como seed; mesma estrutura para Estética com templates próprios):

| Dia | Canal | Tipo |
|---|---|---|
| D1 | E-mail | Abertura personalizada com 1 sinal observado (ex.: nota no Google, ausência de cardápio próprio) |
| D2 | WhatsApp | Template oficial (Cloud API) **ou** tarefa wa.me assistida |
| D4 | Ligação | Tarefa: click-to-call + roteiro |
| D6 | E-mail | Prova/caso curto + pergunta aberta |
| D9 | WhatsApp | Follow-up curto com pergunta de sim/não |
| D11 | Ligação | Tarefa |
| D14 | E-mail | "Encerrando contato" (breakup) com opção de retomar depois |

**E-mail**: provider via env (Resend ou Amazon SES), domínio dedicado, header `List-Unsubscribe` + `List-Unsubscribe-Post` (one-click), link de descadastro que grava na `suppression_list`, webhook de bounce/complaint → suppression automático. Rastreamento de abertura opcional e desligado por padrão.

**WhatsApp Cloud API**: `lib/sdr/whatsapp/cloud.ts` — envio de template (nome, idioma, variáveis), webhook `POST /api/webhooks/whatsapp` com verificação `X-Hub-Signature-256` (HMAC-SHA256 com app secret) e handshake GET. Mensagens dentro da janela de 24h após resposta do lead = texto livre (é aí que a IA conversa). Mantenha um contador de custo estimado por mensagem de template no dashboard (cobrança é por template entregue).

**wa.me assistido (modo sem API)**: mantém o que já existe em `/disparos`, mas agora como **tarefa individual** dentro da cadência, abrindo o WhatsApp Web com texto pré-preenchido; o humano revisa e clica Enviar. Sem envio em massa, sem "enviar para todos".

---

## FASE 5 — AGENTE IA DE PRIMEIRO ATENDIMENTO (BANT + agendamento)

`lib/sdr/agent/` — roda quando o lead responde (WhatsApp Cloud API ou e-mail inbound). Claude com **tool use**; cada ferramenta validada por Zod e executada no servidor:

| Tool | O que faz |
|---|---|
| `get_lead_context(lead_id)` | dados do lead, sinais, histórico resumido, BANT atual |
| `update_bant(lead_id, dimension, score 0–3, evidence)` | grava avaliação com trecho da conversa como evidência |
| `get_available_slots(range)` | consulta Google Calendar (OAuth do dono) ou Cal.com |
| `book_meeting(lead_id, slot, attendee_email?)` | cria evento + Meet, grava `meetings`, move stage para `reuniao_marcada` |
| `handoff_to_human(lead_id, reason)` | pausa IA, notifica dono (push/e-mail), move para fila "Assumir" |
| `mark_opt_out(lead_id, channel)` | grava suppression e encerra |

**System prompt do agente (gravar em `lib/sdr/agent/prompt.ts`, editável por workspace):**

```
Você é a assistente virtual de pré-atendimento da {NOME_DA_EMPRESA}, agência de marketing para {NICHO_LEGIVEL}.
Seu único objetivo: entender se faz sentido uma conversa de 20 minutos com {NOME_DO_CONSULTOR} e, se fizer, agendá-la.

Regras:
- Na primeira resposta, apresente-se como assistente virtual da {NOME_DA_EMPRESA}. Se perguntarem se é robô/IA, confirme.
- Português do Brasil, tom de WhatsApp: mensagens curtas (máx. 3 linhas), uma pergunta por vez, sem jargão.
- Nunca invente preço, prazo, resultado garantido, case ou cliente. Se perguntarem preço: "depende do escopo, é exatamente o que o {NOME_DO_CONSULTOR} fecha na conversa".
- Nunca diga o faturamento estimado do lead nem mostre dados que coletamos sobre ele.
- Se a pessoa pedir para parar, sair, não receber mais mensagens (ou equivalente), chame mark_opt_out e responda só com confirmação educada.
- Se houver irritação, reclamação, assunto jurídico, pedido de falar com humano, ou pergunta fora do escopo → handoff_to_human.
- Qualifique em BANT de forma conversacional, sem parecer questionário (ordem sugerida: Need → Authority → Timing → Budget).
- Assim que BANT >= 7/12 com Authority >= 2: ofereça 2 horários de get_available_slots e agende com book_meeting.
- Se BANT < 7 após 6 trocas: agradeça, ofereça material/contato futuro e encerre (stage: perdido com motivo, ou nutrição).
- Máximo de 12 mensagens suas por conversa; depois disso, handoff_to_human.
```

**Rubrica BANT adaptada a PMEs de food/estética** (cada item 0–3, total 12):

| Dimensão | Pergunta-guia (conversacional) | 3 = | 0 = |
|---|---|---|---|
| **Need** | "Hoje o que mais trava: movimento no salão/agenda, pedidos no delivery ou depender demais do iFood/indicação?" | dor clara e específica, com impacto | "está tudo ótimo" |
| **Authority** | "Você que cuida da parte de marketing aí ou tem sócio/gerente que decide junto?" | dono/sócio decisor | funcionário sem influência |
| **Timing** | "Isso é algo pra resolver agora ou mais pra frente?" | ≤ 30 dias | sem previsão / > 6 meses |
| **Budget** | "Hoje vocês já investem em anúncio ou alguém cuidando das redes? Mais ou menos quanto por mês?" | já investe e aceita investir | zero e sem intenção |

Persistir cada avaliação com evidência. Na ficha do lead mostrar o BANT como 4 barras + score total.

Segurança do agente: limitar tokens por conversa, logar tokens/custo em `conversation_messages`, nunca enviar segredo/PII de outro lead ao modelo, sanitizar markdown antes de renderizar no CRM. Testes com conversas-fixture (lead qualificado, lead sem autoridade, pedido de opt-out, pedido de humano, pergunta de preço, tentativa de prompt injection do tipo "ignore suas instruções").

---

## FASE 6 — EXTENSÃO CHROME "Undercut SDR" (MV3, side panel)

Segue o padrão das extensões do hub (catálogo da `0009_rebrand_undercut_catalog.sql`). Autenticação por chave de API com escopos `leads:ler leads:escrever`.

Funções:
1. **Captura de lead** — em Google Maps (página de um estabelecimento), perfil do Instagram ou site: botão no side panel "Capturar lead" → lê só dados visíveis na página (nome, telefone exibido, site, @) → `POST /api/v1/sdr/leads/capture`. Mostra se já existe (dedupe) e o stage atual.
2. **Card do lead no WhatsApp Web** — ao abrir uma conversa, identifica o número, mostra ficha resumida, BANT, próximo passo e **sugestão de resposta da IA** que o humano pode copiar para a caixa de texto. **A extensão nunca clica em "Enviar" e nunca envia mensagens sozinha.**
3. **Fila de tarefas do dia** — ligações e WhatsApps assistidos da cadência, em ordem de prioridade (ICP score × passo da cadência).
4. **Click-to-call** — abre `tel:` (ou softphone configurado), cronometra, ao encerrar pede resultado (atendeu/não atendeu/caixa postal/pediu retorno/opt-out) e nota → `activities`.
5. **Registrar resultado** — botões rápidos que movem o stage e registram atividade.

Proibido na extensão: raspagem em massa/rolagem automática de listas do Maps ou Instagram, automação de envio no WhatsApp Web, coleta de dados de pessoas físicas além do nome/cargo do responsável.

---

## FASE 7 — INBOUND ORGÂNICO NO MESMO FUNIL

Para fechar o "orgânico" de verdade (não só outbound):
- Endpoint público `POST /api/public/leads/inbound/{workspace_slug}` (rate limit por IP, captcha/turnstile, Zod) para formulários de landing page e link da bio.
- UTM e origem gravados em `leads.source='inbound_form'` + `activities`.
- Lead inbound pula a cadência fria e vai direto para o agente IA (já tem consentimento implícito pelo contato), com checkbox de consentimento no formulário.

---

## TEMPLATES DE MENSAGEM (seed — editáveis na tela de cadências)

**E-mail D1 – Food**
> Assunto: {nome_fantasia} no Google
>
> Oi, {primeiro_nome_ou_equipe}, tudo bem?
> Vi que a {nome_fantasia} tem {google_reviews_count} avaliações no Google e {sinal_observado}.
> Trabalho com restaurantes aqui em {municipio} ajudando a transformar isso em pedido direto (sem depender só de app de delivery).
> Faz sentido eu te mostrar em 15 minutos o que costuma funcionar para casas do seu porte?
> {assinatura}
> Não quer receber mais e-mails? {link_descadastro}

**E-mail D1 – Estética**
> Assunto: agenda da {nome_fantasia}
>
> Oi, {primeiro_nome_ou_equipe}!
> Dei uma olhada na {nome_fantasia} e {sinal_observado}.
> Ajudo clínicas e estúdios de estética em {municipio} a encher horários vagos com clientes da própria região.
> Topa uma conversa rápida de 15 min para eu entender como está a agenda hoje?
> {assinatura}
> Não quer receber mais e-mails? {link_descadastro}

**WhatsApp D2 (template de marketing — submeter à Meta)**
> Olá! Aqui é o {consultor}, da {empresa}. Ajudo {nicho_plural} em {municipio} a atrair mais clientes da região. Posso te mandar uma ideia rápida pensada para a {nome_fantasia}? Se preferir não receber mensagens, responda SAIR.

**E-mail D14 – Breakup**
> Assunto: encerrando por aqui
>
> {primeiro_nome_ou_equipe}, como não tive retorno, imagino que agora não seja o momento — vou parar de te escrever.
> Se em algum momento quiser conversar sobre {dor_principal_do_nicho}, é só responder este e-mail.
> {assinatura}

**Roteiro de ligação (tarefa D4)**
> "Oi, {nome}? Aqui é o {consultor}, da {empresa}. Te pego num momento ruim? — [se ok] — Te mandei uma mensagem sobre {sinal_observado}. Hoje o que mais pesa aí: movimento/agenda ou depender de app/indicação? [ouvir] — Faz sentido marcar 20 minutos essa semana para eu te mostrar o que funcionou em casos parecidos?"

---

## VARIÁVEIS DE AMBIENTE (adicionar ao `.env.example`, nunca valores reais)

```
ANTHROPIC_API_KEY=
GOOGLE_PLACES_API_KEY=
CNPJA_API_KEY=                 # opcional (fallback pago)
WHATSAPP_CLOUD_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_APP_SECRET=           # verificação HMAC do webhook
WHATSAPP_VERIFY_TOKEN=
EMAIL_PROVIDER=resend|ses
RESEND_API_KEY=
EMAIL_SENDING_DOMAIN=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=    # Google Calendar do consultor
SDR_DAILY_EMAIL_LIMIT_PER_INBOX=40
SDR_DAILY_WHATSAPP_TEMPLATE_LIMIT=100
SDR_SEND_WINDOW=09:00-18:00
```

---

## CRITÉRIOS DE ACEITE (checar ao final de cada fase)

- [ ] Toda tabela nova com RLS e teste provando que workspace A não lê lead do workspace B.
- [ ] Nenhuma rota de PII acessível com escopo `catalogo:*`.
- [ ] Nenhum envio/ligação/tarefa gerado para contato na `suppression_list` (teste automatizado).
- [ ] UI nunca mostra "faturamento" — só "faixa estimada" com fontes.
- [ ] Extensão sem nenhum código que dispare clique em "Enviar" no WhatsApp Web (teste/grep no build).
- [ ] Webhook do WhatsApp rejeita assinatura inválida (teste).
- [ ] Agente IA: passa nos 6 cenários-fixture da Fase 5, inclusive opt-out e prompt injection.
- [ ] `npm run lint`, `typecheck` e testes verdes; migrações aplicam do zero em banco limpo.

## ORDEM DE EXECUÇÃO

Fase 0 → (me mostra) → Fase 1 → (me mostra a migração) → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6 → Fase 7.
Em cada fase: plano curto → código → testes → resumo do diff. Se algo deste documento conflitar com o AGENTS.md, **o AGENTS.md vence** e você me avisa.
