# Colaborador por link (só o menu Extensões)

## O que é
- Papel novo `colaborador` (enum `member_role`). Vê **apenas** o menu Extensões: baixar, instalar e usar as extensões.
- O owner gera o link em **Configurações → Equipe e acessos → Link para colaborador**. A pessoa abre `/convite/<token>` e cria o próprio e-mail + senha. O link vale 7 dias e é de uso único.
- Na aba Equipe o owner vê e-mail, papel, data de criação e **último acesso**, mais a lista de links (aguardando / conta criada / cancelado / vencido) com “Cancelar”. Senha ninguém vê (Supabase guarda só o hash).

## Como o isolamento funciona (3 camadas)
1. **Banco** (`20261125120100_member_invites.sql`): `is_workspace_member()` passa a excluir `colaborador`; todas as policies de dados usam essa função, então o colaborador não lê clientes, cardápio, contas, relatórios, SDR etc. nem chamando o PostgREST direto. Ele continua lendo o próprio vínculo (`members`) e o workspace (`is_workspace_any_member`).
2. **App**: `getWorkspaceBySlug()` devolve `null` para colaborador (default-deny); só o layout e a página de Extensões passam `{ allowCollaborator: true }`. Toda tela/server action existente continua negando.
3. **UI**: o menu lateral mostra só Extensões; sem busca, sem “Sincronizar”, sem “ao vivo”.

## Extensões
- Colaborador, editor e visualizador veem a tela simples: cartões das extensões que funcionam (iFood, Cardápio Web, Anota AI) com **Baixar**, “Como usar” e “Como instalar no Chrome”.
- Owner/suporte veem a mesma lista **com o status de conexão de cada uma**, o painel de status e as **Chaves de API**. O restante (código de conexão, relatório, pesquisa, manual, integrações) ficou em “Opções avançadas”, fechado por padrão.
- Pacotes em `public/extensoes/` (versões em `lib/extensions/catalog.ts`). Para atualizar: troque o .zip e a versão do catálogo (o `?v=` evita cache).
- O login dentro da extensão (`/api/v1/extension-auth/login`) agora aceita o papel `colaborador`; a chave gerada tem os mesmos escopos das demais (`clientes:ler`, `catalogo:*`) e aparece em Chaves de API com o e-mail da pessoa. Para impedir, tire `'colaborador'` do `ROLES` desse arquivo.

## Aplicar
1. Backup do banco (AGENTS.md) → aplicar as duas migrations **em ordem** (`supabase db push`).
2. Deploy do preview → testar com um link real → promover.
3. (Opcional) `NEXT_PUBLIC_APP_URL` define o endereço base do link; sem ela usa `brand.baseUrl`.

## Teste manual sugerido
1. Owner: Configurações → Equipe → Link para colaborador → copiar.
2. Janela anônima: abrir o link, criar conta → cai em `/a/<ws>/extensoes` só com o menu Extensões.
3. Na mesma sessão, abrir `/a/<ws>/visao-geral`, `/configuracoes`, `/clientes-prospecao` → 404.
4. Abrir o mesmo link de novo → “Link indisponível”.
5. Owner: ver o e-mail e o “último acesso” na lista; cancelar um link pendente e confirmar que ele deixa de abrir.
