# Riscos e decisões em aberto — Fase 1 (máx. 8)

Cada item traz contexto, opções e **recomendação padrão**. Enquanto não forem decididos, a recomendação está em vigor. Decididos, migrar a decisão para o documento temático.

## 1. Retenção do histórico de imagens (90 dias?)
**Contexto:** `menu_image_history` guarda o arquivo antigo de cada troca para o "desfazer". Armazenamento gratuito do Supabase tem 1 GB; fotos de cardápio em WebP ~80–200 KB → 90 dias ≈ ok para poucos clientes, arriscado em escala.
**Opções:** (a) 30 dias, (b) 90 dias, (c) 180 dias/ilimitado.
**Recomendação:** **90 dias** + job de expurgo diário; medir consumo real no Passo 7 e revisar. Restaurar foto mais antiga que a retenção não será suportado. Buckets pagos só quando necessário.

## 2. ID da extensão no Chrome Web Store vs. instalação unpacked
**Contexto:** `host_permissions`/CORS precisam de origem estável (`chrome-extension://<id>`). Em modo unpacked, o id varia por máquina/desenvolvedor; na Web Store, é fixo.
**Opções:** (a) publicar na Web Store (id fixo, revisão do Google), (b) permitir `chrome-extension://*` (inseguro), (c) allowlist por workspace com id informado no cadastro (manual).
**Recomendação:** **(a) publicar na Web Store** como não listada (unlisted) — id estável, distribuição controlada por você. Para dev, usar (c) com flag `extension_installs.status='active'` e id dev registrado manualmente. **Nunca** `chrome-extension://*` em produção.

## 3. Hash de chave de API: sha-256 simples vs. argon2id
**Contexto:** chaves são segredos de alta entropia (192+ bits) — o modelo de ameaça é vazamento do banco, não brute force.
**Opções:** (a) sha-256 com salt por chave, (b) argon2id (mais lento, sem ganho real para alta entropia), (c) HMAC com pepper no servidor.
**Recomendação:** **sha-256 + salt aleatório por chave** (lookup por prefixo indexado + verificação do hash). Adicionar **pepper** via `ENCRYPTION_KEY` como defesa em profundidade (`HMAC-SHA256(pepper, salt || key)`). argon2id seria custo puro.

## 4. Rate limit por chave: Postgres vs. Upstash Redis
**Contexto:** free tier Vercel + Supabase. Contadores em Postgres funcionam mas geram escrita por request; Upstash Redis (free 10k cmd/dia) é barato e atômico.
**Opções:** (a) tabela Postgres com upsert (zero custo extra, mais latência), (b) Upstash Redis free, (c) Vercel Edge Config/KV.
**Recomendação:** **Fase 1: (a) Postgres** (`rate_limits` com janela fixa por minuto, limpeza via job). Migrar para (b) apenas se métricas mostrarem p95 de auth > 50 ms. Não introduzir Upstash antes de precisar.

## 5. Exclusão definitiva (LGPD) de cliente/workspace: cascata vs. job assíncrono
**Contexto:** LGPD exige exclusão sob solicitação. Hoje há soft-delete (`archived_at`, `deleted_at`). Hard delete em cascata via FK apaga rápido mas sem auditoria granular nem delay de "lixeira".
**Opções:** (a) hard delete imediato com cascata, (b) soft-delete + job de expurgo após N dias, (c) anonimização (manter métricas, apagar PII).
**Recomendação:** **(b) soft-delete + expurgo em 30 dias** (cliente) e **30 dias** (workspace), com `audit_log` registrando o expurgo. Anonimização (c) só para relatórios agregados, se um dia houver analytics. Documentar prazo de atendimento em 30 dias conforme LGPD.

## 6. Webhooks: worker via Vercel Cron vs. `pg_cron` + `pg_net`
**Contexto:** entregas com backoff precisam de um relógio. Vercel Cron no free plan roda no máximo 1×/dia em projetos hobby — **insuficiente** para backoff de minutos.
**Opções:** (a) Vercel Cron (insuficiente no free; 1×/dia), (b) `pg_cron` + `pg_net` no Supabase (grátis, roda no banco), (c) cron externo gratuito (cron-job.org) chamando `/api/cron/webhooks` com `CRON_SECRET`, (d) Supabase Scheduled Functions (Edge Functions agendadas).
**Recomendação:** **(b) `pg_cron` + `pg_net`** para o loop de entrega (a cada 1 min, `FOR UPDATE SKIP LOCKED`), com (c) como fallback se `pg_net` não estiver disponível no plano. Manter `/api/cron/webhooks` como gatilho manual/monitorado mesmo assim.

## 7. Concorrência em fotos: ETag/`If-Match` do item vs. versão da imagem
**Contexto:** a extensão precisa de "detecção de edição concorrente (nome ou foto mudou)". Hoje o `If-Match` proposto é o `updated_at` do item — mas trocar **só a foto** atualiza `menu_images`, não necessariamente `menu_items.updated_at`... a menos que a rotina de troca também "toque" o item.
**Opções:** (a) `updated_at` do item tocado também na troca de imagem, (b) ETag composto `item_updated_at:image_version`, (c) checagem separada de foto via `GET .../image` antes do upload.
**Recomendação:** **(a)+(b):** a rotina única de troca atualiza `menu_items.updated_at`/`menu_subitems.updated_at` **e** o ETag composto exposto pela API é `"{updated_at}:{image_version}"`. Implementar o ETag composto desde o Passo 7 — é barato e elimina a ambiguidade. Registrar como tarefa explícita no roadmap (Passo 7).

## 8. Multi-tenancy de imagens no Storage: bucket único vs. bucket por workspace
**Contexto:** RLS de Storage filtra por pasta-raiz = `workspace_id`. Um bucket único `menu-images` é simples; buckets por workspace isolam melhor, mas multiplicam objetos e políticas e complicam backup/migração.
**Opções:** (a) bucket único + prefixo `{workspace_id}/...` + RLS por `storage.foldername(name)`, (b) bucket por workspace, (c) bucket público com URLs opacas (inaceitável — vazaria fotos por URL).
**Recomendação:** **(a) bucket único privado + RLS por pasta**, exatamente como 0001/0002 definem. (b) só se surgir exigência contratual de isolamento físico (enterprise) — aí migra-se por etapa com script de cópia. (c) nunca.
