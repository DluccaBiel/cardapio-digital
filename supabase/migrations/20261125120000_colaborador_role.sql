-- ============================================================================
-- 20261125120000_colaborador_role.sql — papel "colaborador" (só Extensões)
-- Parte 1/2: apenas o valor do enum. Um valor novo de enum só pode ser USADO
-- depois do commit, por isso as funções/policies ficam na parte 2.
-- ============================================================================
alter type public.member_role add value if not exists 'colaborador';
comment on type public.member_role is 'Papéis por workspace: owner, coordenador (suporte), editor, visualizador e colaborador (somente menu Extensões: baixar e usar; sem dados de negócio).';
