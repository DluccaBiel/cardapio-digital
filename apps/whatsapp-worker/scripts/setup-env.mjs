// Gera apps/whatsapp-worker/.env com a URL e a chave service role do projeto Supabase VINCULADO
// (o mesmo do `supabase link`, hoje AnjimBanco). Usa o login da Supabase CLI deste computador.
// A chave é gravada direto no arquivo e NUNCA aparece na tela. Rode você mesmo:
//   npm run worker:setup            (não sobrescreve um .env existente)
//   npm run worker:setup -- --force (sobrescreve)

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')
const ENV = path.resolve(HERE, '..', '.env')
const force = process.argv.includes('--force')

function fail(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (existsSync(ENV) && !force) fail('apps/whatsapp-worker/.env já existe. Use "npm run worker:setup -- --force" para recriar.')

const refFile = path.join(ROOT, 'supabase', '.temp', 'project-ref')
if (!existsSync(refFile)) fail('Projeto Supabase não vinculado. Rode "npx supabase link" na raiz do projeto.')
const ref = readFileSync(refFile, 'utf8').trim()
if (!/^[a-z0-9]{20}$/.test(ref)) fail('project-ref inválido em supabase/.temp/project-ref.')

let raw
try {
  raw = execFileSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', ref, '-o', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
} catch {
  // Fallback: se a Supabase CLI não estiver logada, tenta ler do .env.local da raiz
  const rootEnvLocal = path.join(ROOT, '.env.local')
  const rootEnv = path.join(ROOT, '.env')
  const fallbackFile = existsSync(rootEnvLocal) ? rootEnvLocal : existsSync(rootEnv) ? rootEnv : null
  if (fallbackFile) {
    const content = readFileSync(fallbackFile, 'utf8')
    let sUrl = ''
    let sKey = ''
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/)
      if (m && !m[1].startsWith('#')) {
        const k = m[1]
        let v = (m[2] || '').trim()
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1)
        }
        if (k === 'SUPABASE_URL') sUrl = v
        if (k === 'SUPABASE_SERVICE_ROLE_KEY') sKey = v
      }
    }
    if (sUrl && sKey) {
      const slug = process.env.UNDERCUT_WORKSPACE ?? ''
      writeFileSync(
        ENV,
        [
          '# Gerado por scripts/setup-env.mjs (via .env.local) — NUNCA commitar (acesso total ao banco).',
          `SUPABASE_URL=${sUrl}`,
          `SUPABASE_SERVICE_ROLE_KEY=${sKey}`,
          `UNDERCUT_WORKSPACE=${slug}`,
          '',
        ].join('\n'),
        { encoding: 'utf8', mode: 0o600 },
      )
      console.log(`✓ apps/whatsapp-worker/.env criado a partir de ${path.basename(fallbackFile)} (chave gravada, não exibida).`)
      console.log('  Agora rode: npm run worker')
      process.exit(0)
    }
  }
  fail('A Supabase CLI não conseguiu listar as chaves e .env.local não possui SUPABASE_SERVICE_ROLE_KEY.')
}

let keys
try {
  const j = JSON.parse(raw)
  keys = Array.isArray(j) ? j : (j.keys ?? j.data ?? Object.values(j).find(Array.isArray) ?? [])
} catch {
  fail('Resposta inesperada da Supabase CLI (atualize com "npm i -D supabase@latest").')
}

// Prefere chave não mascarada (a CLI mascara chaves secretas novas com ···· no JSON).
const unmasked = (k) => k?.api_key && !k.api_key.includes('·') && !k.api_key.includes('...')
const pick =
  keys.find((k) => k.name === 'service_role' && unmasked(k)) ??
  keys.find((k) => k.type === 'secret' && unmasked(k))
if (!pick) fail('Não encontrei chave secreta/service_role no projeto (confira em Project Settings → API Keys).')

const slug = process.env.UNDERCUT_WORKSPACE ?? ''
writeFileSync(
  ENV,
  [
    '# Gerado por scripts/setup-env.mjs — NUNCA commitar (acesso total ao banco).',
    `SUPABASE_URL=https://${ref}.supabase.co`,
    `SUPABASE_SERVICE_ROLE_KEY=${pick.api_key}`,
    `UNDERCUT_WORKSPACE=${slug}`,
    '',
  ].join('\n'),
  { encoding: 'utf8', mode: 0o600 },
)
console.log(`✓ apps/whatsapp-worker/.env criado para o projeto ${ref} (chave "${pick.name ?? pick.type}" gravada, não exibida).`)
console.log('  Agora rode: npm run worker')
