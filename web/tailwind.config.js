/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif',
        ],
      },
      colors: {
        ink: {
          950: '#080a12',
          900: '#0c0f1a',
          800: '#141826',
          700: '#1c2233',
          600: '#272f45',
        },
        brand: {
          400: '#8b8bf6',
          500: '#6d6df0',
          600: '#5b5be6',
        },
        accent: {
          400: '#3fd9c9',
          500: '#22c7b6',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px -20px rgba(91,91,230,0.45)',
        card: '0 8px 40px -12px rgba(0,0,0,0.6)',
      },
      backgroundImage: {
        'mesh':
          'radial-gradient(60% 60% at 20% 10%, rgba(109,109,240,0.18) 0%, transparent 60%), radial-gradient(50% 50% at 90% 20%, rgba(34,199,182,0.16) 0%, transparent 55%), radial-gradient(60% 60% at 60% 100%, rgba(139,92,246,0.12) 0%, transparent 60%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 2.5s linear infinite',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
