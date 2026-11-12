/**
 * Undercut — fonte única da marca (manual: "Undercut - Identidade Visual" V1, 09.11.2026).
 * Toda tela, metadata, e-mail, docs e extensão DEVEM ler daqui o nome,
 * as cores e os caminhos dos logos. Nada de nome/cor hardcoded.
 *
 * O pacote continua `@orvia/brand` e os domínios/slug continuam os da Vercel
 * (as extensões têm o host fixo em host_permissions) — só a identidade mudou.
 */

export const brand = {
  name: 'Undercut',
  slug: 'orvia', // slug técnico (chaves de storage/eventos); não exibir ao usuário
  tagline: 'Ultrapasse pela estratégia',
  description: 'Tráfego pago e estratégia para negócios que querem passar na frente: clientes, contas de anúncio, cardápio, relatórios e extensões.',
  pronunciation: 'ân-der-cât',
  // Endereço público (decidido em 2026-11-11): sem domínio próprio, o link curto da Vercel.
  // As extensões continuam falando com `extensionHubUrl` (o único hub fixo em host_permissions);
  // os dois endereços servem o mesmo deployment.
  domain: 'orviahub.vercel.app',
  baseUrl: 'https://orviahub.vercel.app',
  extensionHubUrl: 'https://orvia-gestao.vercel.app',
  supportEmail: 'suporte@orviahub.com.br', // placeholder: domínio e caixa ainda não existem

  version: '0.3.0',

  /**
   * Paleta do manual (S3 "Preto domina, vermelho decide"): Preto 60% · Asfalto 15% · Gelo 15% · Vermelho 10%.
   * O vermelho é a bandeira da corrida — aparece pouco. `red` (#B5121B) é provisório no manual
   * ("trocar pelo tom do Biel"): ao trocar, ajuste red/redBright/redGlow juntos.
   */
  colors: {
    // Manual
    pista: '#0B0B0C', // Preto Pista — fundo principal
    asfalto: '#161618', // Asfalto — caixas e blocos
    red: '#B5121B', // Vermelho Undercut — destaque e chamada
    gelo: '#F2F0EC', // Gelo — texto e fundo claro
    fumaca: '#8E8A86', // Fumaça — texto de apoio
    // Derivados para tela (contraste AA sobre fundo escuro)
    redBright: '#D7141F', // botões / estado ativo
    redGlow: '#F0333D', // texto/ícone vermelho sobre preto, hover
    redDeep: '#8E0E15',
    bg950: '#070708',
    border: '#232326',
    borderStrong: '#2A2A2E',
    // Semânticos — telemetria: verde = melhorou; laranja-sinal = alerta (≠ vermelho da marca)
    success: '#34D399',
    warning: '#FBBF24',
    danger: '#FF6A3D',
  },

  fonts: {
    display: 'Anton', // títulos — SEMPRE EM MAIÚSCULAS
    text: 'Archivo', // textos, legendas, site
    data: 'JetBrains Mono', // números, rótulos, datas (telemetria)
  },

  logos: {
    logo: '/brand/undercut-logo.svg', // A · corte diagonal, fundo claro
    logoWhite: '/brand/undercut-logo-white.svg', // A · corte diagonal, fundo escuro
    mark: '/brand/undercut-mark.svg', // C · símbolo "U" (avatar escuro)
    markRed: '/brand/undercut-mark-red.svg', // C · avatar claro (fundo vermelho)
    markMono: '/brand/undercut-mark-mono.svg',
    favicon: '/brand/favicon.svg',
  },
} as const

export type Brand = typeof brand
export default brand
