/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./**/*.{ts,tsx}",
    "!./node_modules/**",
    "!./dist/**",
    "!./api/**",
  ],
  theme: {
    extend: {
      boxShadow: { 
        soft: '0 8px 30px rgba(0,0,0,0.08)',
        'card': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
      },
      colors: {
        brand: {
          50:'#f2fbff',100:'#e6f6ff',200:'#cfeeff',300:'#a6dfff',400:'#66c5ff',
          500:'#1fa7ff',600:'#0b86db',700:'#0a6db4',800:'#0c5a92',900:'#0d4b78',950:'#0a3452',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
