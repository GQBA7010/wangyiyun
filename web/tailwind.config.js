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
        brand: {
          50: '#eef0ff',
          100: '#e0e3ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        accent: {
          50: '#ecfdf8',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        card: '0 1px 2px rgba(16,24,40,0.04), 0 18px 40px -20px rgba(30,41,59,0.25)',
        glow: '0 12px 34px -12px rgba(99,102,241,0.55)',
        lift: '0 1px 2px rgba(16,24,40,0.04), 0 28px 56px -24px rgba(30,41,59,0.35)',
      },
      backgroundImage: {
        'mesh':
          'radial-gradient(70% 60% at 12% 0%, rgba(99,102,241,0.12) 0%, transparent 55%), radial-gradient(55% 50% at 96% 6%, rgba(20,184,166,0.12) 0%, transparent 50%), radial-gradient(55% 55% at 50% 115%, rgba(139,92,246,0.10) 0%, transparent 55%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pop-in': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.96)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
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
        'pop-in': 'pop-in 0.32s cubic-bezier(0.22,1,0.36,1) both',
        shimmer: 'shimmer 2.5s linear infinite',
        float: 'float 6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
