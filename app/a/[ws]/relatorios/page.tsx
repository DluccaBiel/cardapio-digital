import { EmptyModule } from '../_components/EmptyModule'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Orvia — Relatórios' }

export default function Page() {
  return (
    <EmptyModule
      title="Gerador de Relatórios"
      description="Gere relatórios por objetivo, com card 4:5 e mensagem pronta para WhatsApp."
      badge="Marco 3"
    />
  )
}
