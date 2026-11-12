import type { Config } from 'tailwindcss'

// Tokens da marca Undercut — fonte única: packages/brand/brand.config.ts
// (valores duplicados aqui por limitação de importação; mantenha sincronizado)
export default {
  content: [
    './app/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './packages/brand/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  corePlugins: {
    preflight: false, // app usa CSS próprio em app/globals.css
  },
  theme: {
    extend: {
      colors: {
        uc: {
          pista: '#0B0B0C',
          asfalto: '#161618',
          red: '#B5121B',
          'red-bright': '#D7141F',
          'red-glow': '#F0333D',
          'red-deep': '#8E0E15',
          gelo: '#F2F0EC',
          fumaca: '#8E8A86',
          border: '#232326',
          'border-strong': '#2A2A2E',
          success: '#34D399',
          warning: '#FBBF24',
          danger: '#FF6A3D',
        },
      },
      borderRadius: {
        card: '6px',
      },
      fontFamily: {
        sans: ['var(--font-text)', 'Archivo', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['var(--font-display)', 'Anton', 'Impact', 'Arial Narrow', 'sans-serif'],
        mono: ['var(--font-data)', 'JetBrains Mono', 'ui-monospace', 'Consolas', 'monospace'],
      },
      keyframes: {
        'uc-sweep': { '0%': { transform: 'translateX(-100%)' }, '100%': { transform: 'translateX(400%)' } },
        'uc-pulse': { '0%, 100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        'uc-sweep': 'uc-sweep 2.8s cubic-bezier(.6,0,.2,1) infinite',
        'uc-pulse': 'uc-pulse 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
