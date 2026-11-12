/**
 * Gera os PNGs da marca Undercut a partir dos SVGs em ../logo/ e copia tudo para public/brand.
 * Uso: npm run build:logos -w @undercut/brand
 * Requer devDependency `sharp`.
 *
 * Os SVGs (logo A "corte diagonal", símbolo C "U" e og-image) já trazem os glifos da Anton
 * convertidos em paths — não dependem da fonte estar instalada.
 */
import { copyFile, readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const logoDir = join(here, '..', 'logo')
const publicDir = join(here, '..', '..', '..', 'public', 'brand')

const mark = await readFile(join(logoDir, 'undercut-mark.svg'))
const favicon = await readFile(join(logoDir, 'favicon.svg'))

const targets = [
  { size: 16, out: 'icon16.png', src: favicon },
  { size: 48, out: 'icon48.png', src: favicon },
  { size: 128, out: 'icon128.png', src: mark },
  { size: 512, out: 'icon512.png', src: mark },
  { size: 180, out: 'apple-touch-icon.png', src: mark },
]

for (const { size, out, src } of targets) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(join(logoDir, out))
  console.log('gerado', out)
}

const og = await readFile(join(logoDir, 'og-image.svg'))
await sharp(og, { density: 192 }).resize(1200, 630).png().toFile(join(logoDir, 'og-image.png'))
console.log('gerado og-image.png')

for (const file of await readdir(logoDir)) {
  await copyFile(join(logoDir, file), join(publicDir, file))
}
await copyFile(join(logoDir, 'og-image.png'), join(publicDir, '..', 'og-image.png'))
console.log('copiado para public/brand')
