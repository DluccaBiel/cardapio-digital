// Uso: baixe Anton-Regular.ttf (Google Fonts, OFL) e rode, numa pasta com opentype.js@1.3.4 instalado:
//   node gen-svgs.mjs <caminho/Anton-Regular.ttf> packages/brand/logo   →   depois: npm run build:logos -w @undercut/brand
// Gera os SVGs da marca Undercut (glifos Anton convertidos em paths — não dependem de fonte instalada)
import opentype from 'opentype.js'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [fontPath, outDir] = process.argv.slice(2)
const font = opentype.loadSync(fontPath)

const C = { pista: '#0B0B0C', asfalto: '#161618', red: '#B5121B', gelo: '#F2F0EC', fumaca: '#8E8A86' }

function textPath(str, size, x = 0, y = 0, spacing = 0) {
  // y = baseline
  let cx = x
  const parts = []
  for (const ch of str) {
    const g = font.charToGlyph(ch)
    parts.push(g.getPath(cx, y, size).toPathData(2))
    cx += (g.advanceWidth / font.unitsPerEm) * size + spacing
  }
  return { d: parts.join(''), width: cx - x - spacing }
}

function bbox(str, size, spacing) {
  const p = new opentype.Path()
  let cx = 0
  for (const ch of str) {
    const g = font.charToGlyph(ch)
    p.extend(g.getPath(cx, 0, size))
    cx += (g.advanceWidth / font.unitsPerEm) * size + spacing
  }
  return p.getBoundingBox()
}

/**
 * Corte diagonal: metade de cima na cor `top`, metade de baixo vermelha e deslocada para a frente.
 * Retorna { svg (conteúdo <g>), w, h } com origem no canto sup. esquerdo.
 */
function cutWord(str, { size, spacing = 0, top, bottom = C.red, shift, id }) {
  const b = bbox(str, size, spacing)
  const h = b.y2 - b.y1
  const w = b.x2 - b.x1
  const { d } = textPath(str, size, -b.x1, -b.y1, spacing)
  const s = shift ?? h * 0.075
  const pad = h * 0.2
  // linha de corte: sobe da esquerda para a direita (ultrapassagem)
  const yl = h * 0.56, yr = h * 0.44
  const topClip = `M${-pad},${-pad}H${w + pad}V${yr}L${-pad},${yl}Z`
  const botClip = `M${-pad},${yl}L${w + pad},${yr}V${h + pad}H${-pad}Z`
  const svg = `<defs><clipPath id="${id}t"><path d="${topClip}"/></clipPath><clipPath id="${id}b"><path d="${botClip}"/></clipPath></defs>
  <path d="${d}" fill="${top}" clip-path="url(#${id}t)"/>
  <g transform="translate(${s.toFixed(2)} 0)"><path d="${d}" fill="${bottom}" clip-path="url(#${id}b)"/></g>`
  return { svg, w: w + s, h }
}

const write = (name, content) => { writeFileSync(join(outDir, name), content.trim() + '\n'); console.log('ok', name) }

// ── Logo A (corte diagonal) ──────────────────────────────────────────────
for (const [name, top, label] of [
  ['undercut-logo-white.svg', C.gelo, 'fundo escuro'],
  ['undercut-logo.svg', C.pista, 'fundo claro'],
]) {
  const L = cutWord('UNDERCUT', { size: 200, spacing: 4, top, id: 'uc' })
  const pad = 8
  write(name, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${(L.w + pad * 2).toFixed(1)} ${(L.h + pad * 2).toFixed(1)}" role="img" aria-label="Undercut">
<!-- Undercut · logo A (corte diagonal) · ${label} -->
${L.svg}
</svg>`)
}

// ── Símbolo C ("U" cortado) ──────────────────────────────────────────────
function uMark({ bg, top, bottom = C.red, rx = 0, border, size = 512, fill = 0.6 }) {
  const U = cutWord('U', { size: 330, top, bottom, id: 'u' })
  const scale = (size * fill) / U.h
  const tw = U.w * scale, th = U.h * scale
  const tx = (size - tw) / 2, ty = (size - th) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="Undercut">
${bg ? `<rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"${border ? ` stroke="${border}" stroke-width="6"` : ''}/>` : ''}
<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">${U.svg}</g>
</svg>`
}
write('undercut-mark.svg', uMark({ bg: C.pista, top: C.gelo, rx: 104 }))
write('favicon.svg', uMark({ bg: C.pista, top: C.gelo, rx: 104, fill: 0.74 }))
write('undercut-mark-red.svg', uMark({ bg: C.red, top: C.gelo, bottom: C.pista, rx: 104 }))
write('undercut-mark-mono.svg', uMark({ top: C.gelo, bottom: C.gelo }))

// ── Open Graph 1200×630 ──────────────────────────────────────────────────
{
  const L = cutWord('UNDERCUT', { size: 250, spacing: 5, top: C.gelo, id: 'og' })
  const scale = 1000 / L.w
  const lx = 100, ly = 315 - (L.h * scale) / 2 - 30
  const tag = textPath('ULTRAPASSE PELA ESTRATÉGIA', 34, 0, 0, 3)
  const tagX = 100, tagY = ly + L.h * scale + 70
  // rastro de velocidade: linhas horizontais deterministas
  let lines = ''
  let seed = 7
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280)
  for (let i = 0; i < 46; i++) {
    const y = Math.round(rnd() * 630), x = Math.round(rnd() * 900) - 200, w = Math.round(300 + rnd() * 900)
    const h = (1 + rnd() * 9).toFixed(1), o = (0.03 + rnd() * 0.09).toFixed(3)
    lines += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#streak)" opacity="${o}"/>`
  }
  write('og-image.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
<defs>
  <linearGradient id="streak" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="redline" x1="0" x2="1"><stop offset="0" stop-color="${C.red}" stop-opacity="0"/><stop offset=".55" stop-color="${C.red}"/><stop offset="1" stop-color="${C.red}" stop-opacity="0"/></linearGradient>
</defs>
<rect width="1200" height="630" fill="${C.pista}"/>
${lines}
<rect x="0" y="${(tagY - 44).toFixed(0)}" width="1200" height="3" fill="url(#redline)"/>
<g transform="translate(${lx} ${ly.toFixed(1)}) scale(${scale.toFixed(4)})">${L.svg}</g>
<path d="${tag.d}" transform="translate(${tagX} ${tagY.toFixed(1)})" fill="${C.fumaca}"/>
</svg>`)
}
