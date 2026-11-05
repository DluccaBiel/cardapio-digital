import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { brand } from '@orvia/brand'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

// App autenticado: renderizar sob demanda (evita pré-render no build sem env do Supabase)
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: brand.description,
  metadataBase: new URL(brand.baseUrl),
  icons: {
    icon: [
      { url: brand.logos.favicon, type: 'image/svg+xml' },
      { url: '/brand/icon512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    title: `${brand.name} — ${brand.tagline}`,
    description: brand.description,
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: brand.name }],
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>{children}</body>
    </html>
  )
}
