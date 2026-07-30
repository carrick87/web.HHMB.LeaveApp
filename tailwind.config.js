/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'primary': '#6366F1',
        'primary-focus': '#4F46E5',
        'primary-light': '#818CF8',
        'secondary': '#10B981',
        'secondary-light': '#34D399',
        'accent': '#F59E0B',
        'accent-light': '#FBBF24',
        'danger': '#EF4444',
        'danger-light': '#F87171',
        'success': '#059669',
        'success-light': '#10B981',
        'background': '#0F172A',
        'background-light': '#1E293B',
        'surface': '#1E293B',
        'surface-light': '#334155',
        'surface-lighter': '#475569',
        'text': '#F1F5F9',
        'text-primary': '#F8FAFC',
        'text-secondary': '#CBD5E1',
        'text-muted': '#94A3B8',
        'text-light': '#E2E8F0',
        'border': '#475569',
        'border-light': '#64748B',
        'input-bg': '#334155',
        'input-border': '#475569',
        'card-bg': '#1E293B',
        'hover-bg': '#334155',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      boxShadow: {
        'elegant': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'elegant-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
        'glow': '0 0 20px rgba(99, 102, 241, 0.3)',
      },
      backdropBlur: {
        'xs': '2px',
      }
    },
  },
  plugins: [],
}
