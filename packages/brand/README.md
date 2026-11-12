# @undercut/brand — Fonte única da marca Undercut

Identidade visual: manual **"Undercut - Identidade Visual" V1** (pasta `UNDERCUT/`, 09.11.2026).
Toda tela, metadata (Next.js), e-mail, documento e comunicação deve ler nome, tagline, paleta, fontes e caminhos dos logos **daqui**. Nome e cor nunca devem ficar hardcoded em componentes/docs.

> O pacote continua `@undercut/brand` e o `slug`/domínios continuam os da Vercel (as extensões têm o host fixo em `host_permissions`). Só a identidade visual e o nome exibido mudaram.

## Conteúdo

| Caminho | O que é |
|---|---|
| `brand.config.ts` | Fonte de verdade: `brand.name`, `brand.tagline`, `brand.colors`, `brand.fonts`, `brand.logos`, `brand.version` |
| `logo/undercut-logo-white.svg` | Logo A · corte diagonal (metade de baixo vermelha e à frente) — fundo escuro |
| `logo/undercut-logo.svg` | Logo A · fundo claro (metade de cima preta) |
| `logo/undercut-mark.svg` | Símbolo C · "U" cortado, avatar escuro (ícone do app) |
| `logo/undercut-mark-red.svg` | Símbolo C · avatar claro (fundo vermelho) |
| `logo/undercut-mark-mono.svg` | Símbolo monocromático (gelo), sem fundo |
| `logo/favicon.svg` | Favicon (U maior para ler em 16px) |
| `logo/icon16/48/128/512.png`, `apple-touch-icon.png` | PNGs gerados |
| `logo/og-image.svg/png` | Open Graph 1200×630 com rastro de velocidade |
| `scripts/build-logos.mjs` | Gera os PNGs e copia tudo para `public/brand` (requer `sharp`) |

Os SVGs trazem os glifos da **Anton** convertidos em paths — renderizam igual em qualquer máquina, sem a fonte instalada.

## Paleta (S3 "Preto domina, vermelho decide")

| Token | Hex | Uso |
|---|---|---|
| `pista` | `#0B0B0C` | fundo principal (≈60%) |
| `asfalto` | `#161618` | caixas e blocos (≈15%) |
| `gelo` | `#F2F0EC` | texto e fundo claro (≈15%) |
| `red` | `#B5121B` | Vermelho Undercut — destaque e chamada (≈10%) — **provisório no manual** |
| `fumaca` | `#8E8A86` | texto de apoio |
| `redBright` / `redGlow` | `#D7141F` / `#F0333D` | derivados para tela: botão/ativo e texto vermelho sobre preto (contraste) |
| `success` | `#34D399` | telemetria: o que melhorou / status ativo |
| `danger` | `#FF6A3D` | alerta — laranja-sinal, para não confundir com o vermelho da marca |

## Tipografia (S4)

- **Anton** — títulos, sempre em MAIÚSCULAS (`font-display`, `.uc-title`)
- **Archivo** — textos (`font-sans`, padrão do body)
- **JetBrains Mono** — números, rótulos, datas, estilo telemetria (`font-mono`)

Carregadas via `next/font/google` em `app/layout.tsx` (variáveis `--font-display`, `--font-text`, `--font-data`).

## Uso no hub (Next.js)

```ts
import { brand } from '@undercut/brand'

export const metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: brand.description,
}
```

Variáveis CSS em `app/globals.css` (`--uc-*`); Tailwind em `tailwind.config.ts` (`uc.*`).

## Regras

1. Não duplique a paleta em outros arquivos — importe `brand.colors` (Tailwind/CSS espelham, mantenha sincronizado).
2. O vermelho aparece pouco: ação principal, item ativo, um destaque por tela. Não pintar blocos inteiros.
3. Trocar o vermelho definitivo ("tom do Biel"): altere `red`/`redBright`/`redGlow` aqui, em `globals.css`, `tailwind.config.ts`, rode `scripts/gen-svgs.mjs` (constante `C.red`) e `npm run build:logos`.
4. Nada de logo, fonte ou nome oficial da Fórmula 1 (manual S8).
5. Ao mudar qualquer valor: altere aqui, rode `npm run build:logos -w @undercut/brand` e commite tudo junto.
