# Fotos e Histórico de Imagens (Sistema de Cardápio)

## Objetivo
Permitir que o administrador altere a foto de produtos mantendo um histórico completo, permitindo desfazer alterações e comparar preços com concorrência.

## Armazenamento
- Bucket público no Supabase Storage chamado `produto-imagens`.
- Cada imagem é armazenada com caminho único: `produto-imagens/{usuarioId}/{timestamp}-{nomeArquivo}`.
- Todas as imagens são otimizadas para 700x700px (mesmo padrão do portal externo).

## Tabelas envolvidas
1. `produtos.imagem_url` — URL da imagem atualmente ativa.
2. `produto_imagens` — histórico de cada upload (arquivo, data, usuário).
3. `produto_imagem_historico` — registro de cada alteração (antes e depois).

## Fluxo de substituição
1. Admin seleciona produto e envia nova imagem.
2. Sistema salva a imagem atual no bucket com nome único.
3. Cria registro em `produto_imagem_historico` com:
   - `produto_id`
   - `usuario_id`
   - `url_antiga` (URL antiga ou null)
   - `url_nova` (URL da nova imagem)
   - `acao` (`inserir`, `alterar`, `excluir`, `restaurar`)
   - `criado_em`
4. Atualiza `produtos.imagem_url` com a nova URL.

## Desfazer alteração
O administrador pode:
- Visualizar o histórico de um produto.
- Clicar em "Restaurar" em um registro anterior.
- O sistema busca a imagem armazenada no bucket (não depende de URL externa que pode expirar) e restaura como ativa.

## Retenção
- Imagens antigas são mantidas indefinidamente no bucket para permitir restauração.
- Caso o produto seja excluído, as imagens vinculadas podem ser mantidas por 30 dias para auditoria, depois removidas (política de descarte).

## Segurança
- Bucket público para leitura das imagens (necessário para exibição no cardápio público).
- Upload restrito a usuários autenticados com papel `admin` ou `cliente` dono do produto.
- Tamanho máximo de arquivo: 5MB.
- Formatos aceitos: PNG, JPG, JPEG, WEBP.
