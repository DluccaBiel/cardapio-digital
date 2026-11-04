# Roadmap Fase 1 – Cardápio Web Hub

## Objetivo
Entregar um sistema funcional de gestão de cardápio com autenticação, produtos, imagens, relatórios e API para extensões, rodando em ambiente gratuito (Supabase + Vercel).

## Etapas

### Fase 1.1 – Estrutura e Autenticação
- [ ] Criar repositório monorepo (apps/hub, apps/extensions, packages/api-types)
- [ ] Configurar Supabase (banco, auth, storage bucket público)
- [ ] Implementar login/cadastro com Supabase Auth
- [ ] Criar perfil de usuário e role (admin/cliente)
- **Critério de aprovação:** Usuário consegue se cadastrar, logar e acessar dashboard vazio.

### Fase 1.2 – Produtos e Imagens
- [ ] Criar tabela produtos com preço, categoria, descrição, preço_referencia
- [ ] Upload de imagem no Supabase Storage (bucket `produto-imagens`)
- [ ] Tela de listagem de produtos com filtro por categoria/status
- [ ] Comparação de preço com referência (abaixo/ideal/acima)
- **Critério de aprovação:** Usuário consegue cadastrar produto com foto e ver status de mercado.

### 1.3 – Relatórios de Otimização
- [ ] Gerar relatório automático com sugestões de preço/descrição
- [ ] Link público para cliente visualizar
- [ ] Cliente aprova ou rejeita relatório
- [ ] Admin aplica alterações aprovadas nos produtos
- **Critério de aprovação:** Cliente acessa link, aprova, e preços são atualizados nos produtos.

### 1.4 – API para Extensões
- [ ] Criar tabela api_keys com hash, escopos, limites
- [ ] Endpoint `/api/v1/produtos` (GET/POST/PUT/DELETE)
- [ ] Endpoint `/api/v1/produtos/{id}/imagem` (PUT)
- [ ] Endpoint `/api/v1/relatorios` (GET)
- [ ] Documentação em `docs/api.md`
- **Critério de aprovação:** Extensão consegue autenticar, listar produtos e enviar imagem.

### 1.5 – Testes e Deploy
- [ ] Testar fluxo completo em ambiente local
- [ ] Configurar variáveis de ambiente no Vercel
- [ ] Fazer deploy no Vercel + Supabase
- [ ] Testar em produção com cliente real
- **Critério de aprovação:** Sistema acessível via URL pública e funcional.

---

## Critério Geral de Pronto (DoD)
- Código revisado e com pelo menos um teste manual
- Variáveis de ambiente configuradas no Vercel
- Banco de dados com RLS ativo
- Relatório de otimização funcionando end-to-end

## Próximas Fases (não nesta fase)
- Fase 2: Cardápio público e pedidos online
- Fase 3: Integração Meta Ads, relatórios automáticos, WhatsApp
