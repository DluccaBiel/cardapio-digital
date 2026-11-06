#!/usr/bin/env node
import { build } from 'esbuild'

const common = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome114',
  minify: false,
  sourcemap: true,
  logLevel: 'error',
  // ORVIA_E2E=1 só para o teste automatizado (Shadow DOM aberto para o Playwright). Nunca publicar esse build.
  define: { __ORVIA_SHADOW__: JSON.stringify(process.env.ORVIA_E2E === '1' ? 'open' : 'closed') },
}

const entries = {
  'dist/page-hook.js': 'src/page/hook.ts', // MAIN world, document_start (somente leitura)
  'dist/content.js': 'src/content/main.ts', // painel lateral no portal
  'dist/background.js': 'src/background/worker.ts', // service worker (fala com o Orvia)
  'dist/options.js': 'src/options/options.ts', // página de conexão
  'dist/hub-bridge.js': 'src/hub-bridge/main.ts', // "conectar com um clique" na tela Extensões do Orvia
}

try {
  await Promise.all(Object.entries(entries).map(([outfile, entry]) => build({ ...common, entryPoints: [entry], outfile })))
  console.log('Build concluído:', Object.keys(entries).join(', '))
} catch (error) {
  console.error('Build falhou:', error)
  process.exit(1)
}
