export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#06070d',
          900: '#0b0d18',
          800: '#12152a',
          700: '#1c2040',
          600: '#2a3057',
        },
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
      },
      backgroundImage: {
        'grad-primary': 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
        'grad-violet': 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
        'grad-cyan': 'linear-gradient(135deg, #22d3ee 0%, #0ea5e9 100%)',
        'grad-emerald': 'linear-gradient(135deg, #34d399 0%, #059669 100%)',
        'grad-rose': 'linear-gradient(135deg, #fb7185 0%, #e11d48 100%)',
        'grad-text': 'linear-gradient(90deg, #c4b5fd, #67e8f9, #c4b5fd)',
      },
      boxShadow: {
        'glow-violet': '0 0 32px -4px rgba(139, 92, 246, 0.55)',
        'glow-cyan': '0 0 32px -4px rgba(34, 211, 238, 0.45)',
        'glow-rose': '0 0 32px -4px rgba(251, 113, 133, 0.45)',
        'inner-glow': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.06)',
      },
      animation: {
        'gradient-flow': 'gradientFlow 6s ease infinite',
        'gradient-text': 'gradientText 4s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'float-slow': 'float 12s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
        'shimmer': 'shimmer 2.2s linear infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scaleIn 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
        'spin-slow': 'spin 3s linear infinite',
        'orbit': 'orbit 20s linear infinite',
      },
      keyframes: {
        gradientFlow: {
          '0%, 100%': { 'background-position': '0% 50%' },
          '50%': { 'background-position': '100% 50%' },
        },
        gradientText: {
          '0%': { 'background-position': '0% 50%' },
          '100%': { 'background-position': '200% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
        pulseGlow: {
          '0%, 100%': { 'box-shadow': '0 0 24px -4px rgba(139, 92, 246, 0.55)' },
          '50%': { 'box-shadow': '0 0 48px -4px rgba(34, 211, 238, 0.65)' },
        },
        shimmer: {
          '0%': { 'background-position': '-200% 0' },
          '100%': { 'background-position': '200% 0' },
        },
        fadeIn: {
          '0%': { opacity: 0 },
          '100%': { opacity: 1 },
        },
        slideUp: {
          '0%': { opacity: 0, transform: 'translateY(16px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: 0, transform: 'scale(0.95)' },
          '100%': { opacity: 1, transform: 'scale(1)' },
        },
        orbit: {
          '0%': { transform: 'rotate(0deg) translateX(40px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(40px) rotate(-360deg)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
