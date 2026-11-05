/**
 * Orvia — fonte única da marca.
 * Toda tela, metadata, e-mail, docs e extensão DEVEM ler daqui o nome,
 * as cores e os caminhos dos logos. Nada de nome/cor hardcoded.
 */

export const brand = {
  name: 'Orvia',
  slug: 'orvia',
  tagline: 'Gestão que conecta',
  description: 'Hub de gestão para assessorias: clientes, cardápio, relatórios e extensões.',
  // Placeholders — substituir pelos valores reais quando o domínio estiver registrado.
  domain: 'orvia.example',
  baseUrl: 'https://orvia.example',
  supportEmail: 'suporte@orvia.example',
  version: '0.2.0',

  colors: {
    // Primária (azul Orvia — luminoso, alta tecnologia)
    primary700: '#1F4FD6',
    primary600: '#2F6BFF',
    primary500: '#3D8EFF',
    primary400: '#6EA8FF',
    accentCyan: '#22D3EE',
    // Fundos (tema escuro)
    bg950: '#070B14',
    bg900: '#0B1220',
    surface: '#111A2E',
    border: '#1C2A47',
    // Texto
    text: '#E6ECFA',
    muted: '#8FA0C4',
    // Semânticos (verde só para status "ok/ativo")
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#F87171',
  },

  logos: {
    mark: '/brand/orvia-mark.svg',
    markMono: '/brand/orvia-mark-mono.svg',
    logo: '/brand/orvia-logo.svg',
    logoWhite: '/brand/orvia-logo-white.svg',
    favicon: '/brand/favicon.svg',
  },
} as const

export type Brand = typeof brand
export default brand
