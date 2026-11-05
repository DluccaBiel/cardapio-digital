# Fotos e histórico de imagens — Cardápio

> Backup do banco antes de qualquer migração em produção. Este documento cobre o fluxo de upload, versionamento e o "desfazer" (undo) de troca de fotos — incluindo a troca em massa feita pela extensão de navegador.

## 1. Princípios

1. **A imagem antiga NUNCA é descartada numa troca.** Ela vai para `menu_image_history` com o caminho do arquivo no Storage, não com uma URL que pode expirar.
2. **URLs são sempre derivadas.** O banco guarda `storage_path` (+ `checksum_sha256`). URLs públicas/signed são geradas sob demanda pelo servidor. Se a URL assinada expirar, o arquivo continua lá.
3. **Uma imagem corrente por dono.** Índice único parcial `uq_menu_images_current` garante no máximo uma linha `menu_images` com `is_current = true` por `(owner_type, owner_id)`.
4. **Versionamento monotônico.** `version` incrementa a cada troca (1, 2, 3...). Histórico guarda a versão aposentada.

## 2. Bucket e caminho

- Bucket: **`menu-images`** (privado, criado na migração 0001).
- Caminho: `{workspace_id}/{client_id}/{owner_type}/{owner_id}/{version}.{ext}`
  - Exemplo: `3fa8.../9b21.../menu_item/77aa.../4.webp`
- Escrita **somente via API** (service role, após validar escopo da chave/usuário). Extensões nunca falam diretamente com o bucket.
- Leitura: signed URL de curta duração (ex.: 15 min) gerada pelo servidor, ou proxy `GET /api/v1/images/{id}/content`.
- RLS de Storage (`0002_rls.sql`): leitura por membros do workspace (pasta-raiz = `workspace_id`); sem INSERT/UPDATE/DELETE para `authenticated`.

## 3. Fluxo de troca de foto (unitário e em massa)

Toda troca — pelo painel ou por extensão — passa por **uma única rotina** no servidor (`replaceImage`):

```text
1. Recebe arquivo (multipart ou base64) + owner_type/owner_id + If-Match (updated_at esperado)
2. Valida: tipo MIME real (magic bytes: webp/jpeg/png), tamanho ≤ 5 MB, dimensões ≤ 4096px
3. Converte para WebP (qualidade 82) e calcula checksum_sha256
4. transaction:
   a. SELECT ... FOR UPDATE na imagem corrente
   b. Se não há imagem corrente: version = 1; senão: move a corrente para o histórico
      - novo objeto em menu_image_history: storage_path ANTIGO, version, checksum,
        replaced_by_type ('user'|'api_key'), replaced_by, reason ('bulk_extension'|'manual'|'restore')
      - UPDATE menu_images: storage_path=NOVO, version=version+1, is_current=true
   c. INSERT em audit_log (action='image.replace', actor_type conforme origem)
5. commit
6. Upload do NOVO objeto no bucket (antes do commit? Não: upload primeiro → depois transaction;
   se a transaction falhar, remover o objeto novo órfão)
7. Emite webhook menu.image.replaced
```

Ordem segura: **upload do arquivo novo → transaction (troca + histórico + audit) → resposta**. Se o upload falhar, nada muda. Se a transaction falhar, deletar o arquivo novo (compensação).

### 3.1 Em massa pela extensão

- A extensão envia **uma imagem por requisição** para `POST /api/v1/menu/items/{id}/image` (ou `/subitems/...`), com `X-API-Key` e `If-Match`.
- "Conferência antes de aplicar" e "detecção de edição concorrente" continuam na extensão: ela lê `updated_at` na etapa de conferência e manda no `If-Match`; se o servidor responder `409 Conflict` (nome ou foto mudou desde a leitura), a extensão marca o item como `conflict` e **não aplica**.
- "Pausa entre envios" continua na extensão (ex.: 300–500 ms entre requests) e é reforçada pelo rate limit por chave no servidor (padrão 60 req/min, configurável por chave).
- O **backup para desfazer** da extensão passou a ser apenas a *lista de `(owner_id, version, new_storage_path)` aplicada*; o desfazer real é `POST /api/v1/images/{id}/restore` por item, que restaura a versão anterior do histórico. Assim o desfazer funciona mesmo se a extensão for fechada ou o computador for desligado no meio.

## 4. Desfazer (restore)

`POST /api/v1/images/{id}/restore` (escopo `catalogo:escrever`):
1. Busca a entrada mais recente de `menu_image_history` para o dono da imagem `{id}` (ou `?version=N` para versão específica).
2. Copia o objeto **antigo** no bucket para `.../{version_atual+1}.webp` (nova versão, nunca sobrescreve).
3. Move a corrente atual para o histórico (reason='restore').
4. Atualiza `menu_images` (nova current) e grava audit_log.

## 5. Formatos, limites e transformações

| Item | Regra |
|---|---|
| MIME aceitos no upload | `image/webp`, `image/jpeg`, `image/png` (validar magic bytes, não só o header) |
| Tamanho máximo | 5 MB por arquivo |
| Dimensão máxima | 4096×4096 px; lado mínimo 256 px |
| Armazenamento | WebP q82, metadados removidos (EXIF stripped — privacidade) |
| Checksum | SHA-256 do binário final (pós-conversão) |

## 6. Retenção

| Dado | Retenção | Ação |
|---|---|---|
| Imagem corrente (`menu_images`) | Enquanto o item existir | Soft-delete do item mantém a imagem; exclusão definitiva só por job com service_role |
| Histórico (`menu_image_history` + objetos antigos no bucket) | **90 dias** por padrão (configurável por workspace no futuro) | Job diário (`pg_cron` ou Supabase Scheduled Function) remove objetos > 90 dias e as linhas correspondentes |
| Audit log de troca de imagem | 12 meses | Particionamento/expurgo mensal (ver docs/decisoes-em-aberto.md) |

> Justificativa: 90 dias cobre o ciclo operacional (cardápio semanal/mensal e sazonalidade de fotos) sem acumular lixo de testes em massa. Restaurar algo mais antigo que 90 dias não é suportado por padrão — decisão em aberto registrada em `docs/decisoes-em-aberto.md`.

## 7. Segurança

- Nome do arquivo nunca vem do cliente (sempre gerado: UUID + versão).
- Sem SVG (vetor = risco de XSS/script embutido).
- Objetos do bucket não são listáveis publicamente; signed URLs com TTL curto.
- `checksum_sha256` permite detectar troca silenciosa de conteúdo (auditoria/forense).
- Service role key somente no servidor; extensões recebem no máximo URLs assinadas, nunca credenciais do Storage.

## 8. LGPD

Fotos de cardápio não são dados pessoais, mas **pessoas podem aparecer acidentalmente** em imagens. Por isso: EXIF é removido no upload; a exclusão definitiva de um workspace (`workspaces.deleted_at` + job de expurgo) remove bucket, `menu_images`, `menu_image_history` e `audit_log` associados dentro de 30 dias.
