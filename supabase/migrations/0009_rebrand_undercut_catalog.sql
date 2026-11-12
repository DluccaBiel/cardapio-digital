-- ============================================================================
-- 0009 — Rebrand Undercut: nomes exibidos do catálogo de extensões
-- ----------------------------------------------------------------------------
-- Só troca name/description. Os slugs (orvia-ifood, orvia-cardapioweb,
-- orvia-anotaai) NÃO mudam: estão nas chaves de API emitidas, no código da
-- extensão instalada e nos testes. Idempotente.
-- Aplicar: backup (`supabase db dump --remote`) → `supabase db reset` local →
-- testes → `supabase db push`.
-- ============================================================================

update public.extensions set
    name = 'Undercut · Otimizador iFood',
    description = 'Lê o cardápio no Portal do Parceiro iFood, envia para o Undercut e guia a aplicação de combos e edições feitas no painel.'
where slug = 'orvia-ifood';

update public.extensions set
    name = 'Undercut · Otimizador Cardápio Web',
    description = 'Sincroniza o cardápio do Portal do Cardápio Web, analisa com o Undercut, aplica o que você aprovar e envia o relatório com prints.'
where slug = 'orvia-cardapioweb';

update public.extensions set
    name = 'Undercut · Otimizador Anota AI',
    description = 'Sincroniza o cardápio do painel do Anota AI, analisa com o Undercut, aplica o que você aprovar e envia o relatório com prints.'
where slug = 'orvia-anotaai';
