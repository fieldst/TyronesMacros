/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',  // ✅ enables toggling by adding/removing the `dark` class
  content: [
    "./index.html",
    "./**/*.{ts,tsx}",
    "!./node_modules/**",
    "!./dist/**",
    "!./api/**",
  ],
  theme: {
    extend: {
      boxShadow: { soft: '0 8px 30px rgba(0,0,0,0.08)' },
      colors: {
        brand: {
          50:'#f2fbff',100:'#e6f6ff',200:'#cfeeff',300:'#a6dfff',400:'#66c5ff',
          500:'#1fa7ff',600:'#0b86db',700:'#0a6db4',800:'#0c5a92',900:'#0d4b78',950:'#0a3452',
        }
      }
    },
  },
  plugins: [],
};
