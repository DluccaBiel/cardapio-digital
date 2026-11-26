-- ============================================================================
-- Extensões: slugs do catálogo passam de orvia-* para undercut-*
-- ----------------------------------------------------------------------------
-- Só troca extensions.slug. As chaves de API e as instalações apontam para a
-- extensão pelo id (uuid), então nada mais muda. Idempotente: roda de novo sem
-- efeito e, em banco novo, não encontra nada para trocar.
-- Extensões instaladas com o nome antigo precisam ser atualizadas para os
-- pacotes undercut-* (o servidor passa a aceitar só os nomes novos).
-- Aplicar: backup (`supabase db dump --remote`) → `supabase db reset` local →
-- testes → `supabase db push`.
-- ============================================================================

update public.extensions e
set slug = 'undercut-' || substr(e.slug, length('orvia-') + 1)
where e.slug like 'orvia-%'
  and not exists (
    select 1 from public.extensions x
    where x.slug = 'undercut-' || substr(e.slug, length('orvia-') + 1)
  );
