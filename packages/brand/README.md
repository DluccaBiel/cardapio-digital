# @orvia/brand — Fonte única da marca Orvia

Toda tela, metadata (Next.js), e-mail, documento, extensão e comunicação deve ler nome, slug, tagline, paleta e caminhos dos logos **daqui**. Nome e cor nunca devem ficar hardcoded em componentes/docs.

## Conteúdo

| Caminho | O que é |
|---|---|
| `brand.config.ts` | Fonte de verdade em TypeScript: `brand.name`, `brand.colors`, `brand.logos`, `brand.version` |
| `logo/orvia-mark.svg` | Ícone quadrado 512, fundo em gradiente azul, símbolo "órbita + destino" |
| `logo/orvia-logo.svg` | Logo horizontal (mark + "Orvia") para fundo claro |
| `logo/orvia-logo-white.svg` | Logo horizontal com texto branco para fundo escuro |
| `logo/orvia-mark-mono.svg` | Mark monocromático (branco) para fundos escuros / gravação |
| `logo/favicon.svg` | Favicon (mesmo mark) |
| `logo/icon16/48/128/512.png` | PNG para extensão Chrome (`manifest.icons`, toolbar) |
| `logo/apple-touch-icon.png` | 180×180 para iOS |
| `logo/og-image.png` | 1200×630 Open Graph |
| `scripts/build-logos.mjs` | Gera os PNGs a partir dos SVGs (requer `sharp`, devDependency) |

## Uso no hub (Next.js)

```ts
import { brand } from '@orvia/brand'

export const metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: brand.description,
}
```

Variáveis CSS (ver `app/globals.css` do hub): `:root { --orvia-primary-500: … }`.
Tailwind (quando o shell for migrado): `theme.extend.colors` com os mesmos valores de `brand.colors`.

## Regras

1. Não duplique a paleta em outros arquivos — importe `brand.colors`.
2. Verde (`#34D399`) é exclusivamente status "ok/ativo". Destaque/ação = azul `primary-500`.
3. Para PNGs das extensões: copie `logo/icon*.png` para `apps/extensions/<nome>/icons/` e referencie no `manifest.json`.
4. Domínios/e-mails de exemplo (`orvia.example`) são **placeholders** até o registro do domínio.
5. Ao mudar qualquer valor: altere aqui, rode `npm run build:logos`, e commite tudo junto.

## Gerar os PNGs

```bash
npm install                # instala sharp (devDependency desta workspace)
npm run build:logos -w @orvia/brand
```
