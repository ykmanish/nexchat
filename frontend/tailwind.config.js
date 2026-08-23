/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-satre)', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-satre)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Every surface reads from a CSS variable so themes swap instantly.
        // `rgb(... / <alpha-value>)` rather than a bare var(): without the
        // placeholder Tailwind silently drops any `/NN` opacity modifier,
        // and the utility falls back to its preflight default.
        app: 'rgb(var(--app-bg-rgb) / <alpha-value>)',
        surface: {
          DEFAULT: 'var(--surface)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
          raised: 'var(--raised)',
        },
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        ink: {
          DEFAULT: 'rgb(var(--text-rgb) / <alpha-value>)',
          soft: 'var(--text-soft)',
          muted: 'var(--text-muted)',
          faint: 'rgb(var(--text-faint-rgb) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          strong: 'var(--accent-strong)',
          deep: 'var(--accent-deep)',
          ink: 'var(--accent-ink)',
          tint: 'var(--accent-tint)',
        },
        // Fixed WhatsApp-family greens, for places that must not shift.
        wa: {
          50: '#e7fbef',
          100: '#d9fdd3',
          200: '#a5e5b8',
          300: '#6ede93',
          400: '#3ecf76',
          500: '#21c063',
          600: '#1daa61',
          700: '#128c7e',
          800: '#075e54',
          900: '#005c4b',
        },
        tick: 'var(--tick-read)',
        danger: 'var(--danger)',
        warn: 'var(--warning)',
        info: 'var(--info)',
      },
      borderRadius: {
        bubble: '8px',
        card: '12px',
        sheet: '16px',
      },
      boxShadow: {
        bubble: '0 1px 0.5px rgba(var(--shadow-key), .13)',
        card: '0 1px 3px rgba(var(--shadow-key), .08), 0 1px 2px rgba(var(--shadow-key), .04)',
        pop: '0 12px 32px -8px rgba(var(--shadow-key), .28), 0 2px 8px rgba(var(--shadow-key), .08)',
        sheet: '0 -6px 32px -8px rgba(var(--shadow-key), .22)',
        fab: '0 4px 12px rgba(33, 192, 99, .32)',
        header: '0 1px 0 var(--border)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.32,.72,0,1)',
        'out-expo': 'cubic-bezier(.16,1,.3,1)',
        bounce: 'cubic-bezier(.34,1.4,.64,1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .28s cubic-bezier(.16,1,.3,1) both',
        'scale-in': 'scale-in .18s cubic-bezier(.34,1.4,.64,1) both',
        'typing-dot': 'typing-dot 1.2s infinite',
        'pulse-ring': 'pulse-ring 1.6s cubic-bezier(.16,1,.3,1) infinite',
        'record-pulse': 'record-pulse 1.4s ease-in-out infinite',
      },
      screens: {
        xs: '400px',
      },
    },
  },
  plugins: [],
};
