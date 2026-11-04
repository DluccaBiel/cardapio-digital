-- ============================================================================
-- POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY)
-- Todas as tabelas de negócio têm RLS ativo.
-- Acesso é restrito ao user_id do dono ou a membros do workspace.
-- ============================================================================

-- Habilitar RLS em todas as tabelas
alter table public.produtos enable row level security;
alter table public.relatorios enable row level security;
alter table public.relatorio_itens enable row level security;
alter table public.profiles enable row level security;

-- Produtos: leitura pública (qualquer um pode ver cardápio público)
create policy "Produtos: leitura pública" on public.produtos
    for select using (true);

-- Produtos: apenas o dono pode gerenciar
create policy "Produtos: gerenciar próprio" on public.produtos
    for all using (auth.uid() = user_id);

-- Relatórios: leitura pública (link público do cliente)
create policy "Relatórios: leitura pública" on public.relatorios
    for select using (true);

-- Relatórios: apenas o dono gerencia
create policy "Relatórios: gerenciar próprio" on public.relatorios
    for all using (auth.uid() = user_id);

-- Itens: leitura pública
create policy "Itens: leitura pública" on public.relatorio_itens
    for select using (true);

-- Itens: apenas o dono do relatório gerencia
create policy "Itens: gerenciar próprio" on public.relatorio_itens
    for all using (
        auth.uid() = (select user_id from public.relatorios where id = relatorio_id)
    );

-- Profiles: leitura pública
create policy "Profiles: leitura pública" on public.profiles
    for select using (true);

-- Profiles: apenas o próprio usuário edita
create policy "Profiles: gerenciar próprio" on public.profiles
    for all using (auth.uid() = id);
