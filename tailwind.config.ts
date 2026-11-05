import type { Config } from 'tailwindcss'

// Tokens da marca Orvia — fonte única: packages/brand/brand.config.ts
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
        primary: {
          400: '#6EA8FF',
          500: '#3D8EFF',
          600: '#2F6BFF',
          700: '#1F4FD6',
        },
        accentcyan: '#22D3EE',
        surface: '#111A2E',
        'orvia-surface': '#111A2E',
        border: '#1C2A47',
        'bg-950': '#070B14',
        'bg-900': '#0B1220',
        orvia: {
          text: '#E6ECFA',
          muted: '#8FA0C4',
          success: '#34D399',
          warning: '#FBBF24',
          danger: '#F87171',
          gold: '#D4AF37',
        },
      },
      borderRadius: {
        card: '12px',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
