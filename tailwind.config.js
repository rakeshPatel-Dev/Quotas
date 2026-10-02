/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral charcoal. No hue in the chrome: colour is reserved for
        // meaning (low quota, failure), never decoration.
        base: '#0C0C0E',
        surface: '#141417',
        raised: '#1D1D21',
        line: '#24242A',
        'line-strong': '#3A3A42',
        ink: '#FAFAFA',
        'ink-dim': '#A0A0AA',
        'ink-faint': '#6C6C78',
        // Status ladder. Deliberately four distinct steps rather than a
        // red/amber/green trio, so "low", "throttled" and "dead" never read the
        // same. All clear 4.5:1 on surface.
        healthy: '#3FB950',
        caution: '#E3C13A',
        warn: '#E08A3C',
        critical: '#F0553E',
        // Text on a light (white) surface. Deliberately not called `base`:
        // `text-base` is Tailwind's 1rem font-size utility and would collide.
        'ink-inverse': '#0C0C0E',
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // A tight, deliberate scale. Micro labels are uppercase + tracked;
        // values are never more than one step below their label.
        micro: ['0.625rem', { lineHeight: '0.875rem', letterSpacing: '0.09em' }],
        meta: ['0.6875rem', { lineHeight: '1rem' }],
        small: ['0.75rem', { lineHeight: '1.0625rem' }],
        body: ['0.8125rem', { lineHeight: '1.1875rem' }],
        value: ['0.875rem', { lineHeight: '1.25rem' }],
        title: ['0.9375rem', { lineHeight: '1.375rem', letterSpacing: '-0.008em' }],
        heading: ['1.0625rem', { lineHeight: '1.5rem', letterSpacing: '-0.014em' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(0 0 0 / 0.4)',
        pop: '0 12px 32px -12px rgb(0 0 0 / 0.7)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
}