/**
 * Gera os PNGs da marca Orvia a partir dos SVGs em ../logo/.
 * Uso: npm run build:logos -w @orvia/brand
 * Requer devDependency `sharp`.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const logoDir = join(here, '..', 'logo')

const mark = await readFile(join(logoDir, 'orvia-mark.svg'))
const markMono = await readFile(join(logoDir, 'orvia-mark-mono.svg'))
void markMono

const targets = [
  { size: 16, out: 'icon16.png' },
  { size: 48, out: 'icon48.png' },
  { size: 128, out: 'icon128.png' },
  { size: 512, out: 'icon512.png' },
  { size: 180, out: 'apple-touch-icon.png' },
]

for (const { size, out } of targets) {
  await sharp(mark, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(logoDir, out))
  console.log('gerado', out)
}

// Open Graph 1200x630 — mark à esquerda, wordmark + tagline à direita
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#070B14"/>
      <stop offset="1" stop-color="#111A2E"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3D8EFF"/>
      <stop offset="1" stop-color="#1F4FD6"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#3D8EFF" stop-opacity="0.35"/>
      <stop offset="1" stop-color="#3D8EFF" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="330" cy="315" r="300" fill="url(#glow)"/>
  <g transform="translate(190,175) scale(0.546875)">
    <rect width="512" height="512" rx="112" fill="url(#mark)"/>
    <circle cx="256" cy="256" r="108" fill="none" stroke="#FFFFFF" stroke-width="54"
            stroke-dasharray="568.6 110" stroke-linecap="butt"/>
    <circle cx="350" cy="201" r="38" fill="#FFFFFF"/>
  </g>
  <text x="520" y="330" font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="132"
        font-weight="800" letter-spacing="-3" fill="#E6ECFA">Orvia</text>
  <text x="520" y="400" font-family="'Segoe UI', Inter, Arial, sans-serif" font-size="34"
        fill="#8FA0C4">Gestão que conecta</text>
</svg>`

await writeFile(join(logoDir, 'og-image.svg'), og)
await sharp(Buffer.from(og), { density: 384 }).resize(1200, 630).png().toFile(join(logoDir, 'og-image.png'))
console.log('gerado og-image.png')
