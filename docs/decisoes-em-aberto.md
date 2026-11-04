# Decisões em Aberto – Fase 1

| # | Questão | Opção A | Opção B | Recomendação | Status |
|---|---------|---------|---------|--------------|--------|
| 1 | Hospedagem do frontend | Vercel (grátis) | Render (grátis) | **Vercel** – melhor integração com Next.js | Pendente |
| 2 | Banco de dados | Supabase (grátis) | Railway PostgreSQL (pago após teste) | **Supabase** – inclui Auth + Storage grátis | Pendente |
| 3 | Autenticação | Supabase Auth | NextAuth.js + PostgreSQL | **Supabase Auth** – menos código, já integrado | Pendente |
| 4 | Formato de imagens | WebP | JPEG | **WebP** – menor tamanho, qualidade similar | Pendente |
| 5 | Tamanho máximo da imagem | 5MB | 10MB | **5MB** – evita abuso de storage grátis | Pendente |
| 6 | Limite de requisições API por chave | 100/dia | 1000/dia | **1000/dia** – mais útil para extensões ativas | Pendente |
| 7 | Retenção de imagens antigas | Manter para sempre | Excluir após 30 dias se produto deletado | **Manter 30 dias** – equilíbrio entre backup e custo | Pendente |
| 8 | Idioma do sistema | Português (PT-BR) | Inglês | **Português (PT-BR)** – público-alvo nacional | Pendente |

## Riscos
- **Custo do Supabase:** Plano gratuito tem limite de 500MB storage e 2GB de transferência. Monitorar uso de imagens.
- **Bloqueio do portal.cardapioweb.com:** A extensão original acessa um site de terceiros. Nossa extensão deve operar apenas no nosso próprio sistema, não no portal externo.
- **Segurança de chaves de API:** Chave exposta no cliente pode ser roubada. Usar escopos restritos e rotação periódica.

## Próximas Decisões
- Definir se o sistema será multilíngue (só PT-BR por enquanto).
- Definir se haverá cobrança por workspace ou uso gratuito ilimitado na Fase 1.
