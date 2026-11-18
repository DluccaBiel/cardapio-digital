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
  fail('A Supabase CLI não conseguiu listar as chaves. Rode "npx supabase login" e tente de novo.')
}

let keys
try {
  const j = JSON.parse(raw)
  keys = Array.isArray(j) ? j : (j.keys ?? j.data ?? Object.values(j).find(Array.isArray) ?? [])
} catch {
  fail('Resposta inesperada da Supabase CLI (atualize com "npm i -D supabase@latest").')
}

// Prefere a chave secreta nova (sb_secret_…); senão, a service_role legada.
const pick =
  keys.find((k) => k.type === 'secret' && k.api_key) ??
  keys.find((k) => k.name === 'service_role' && k.api_key)
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
