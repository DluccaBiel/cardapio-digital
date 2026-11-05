/**
 * Flag da rota pública de demonstração.
 * Ligar SOMENTE em Preview na Vercel: NEXT_PUBLIC_DEMO_UI=1
 * Em Production deve permanecer ausente (a rota responde 404).
 */
export function isDemoEnabled(): boolean {
  return process.env['NEXT_PUBLIC_DEMO_UI'] === '1'
}

export function appEnvLabel(): string {
  const env = process.env['VERCEL_ENV']
  if (env === 'production') return 'PROD'
  if (env === 'preview') return 'PREVIEW'
  return 'DEV'
}
