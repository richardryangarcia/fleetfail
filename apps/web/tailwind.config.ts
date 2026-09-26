import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        nc: {
          bg: '#0a0b0d',
          elev: '#111318',
          panel: '#0e1014',
          line: '#1e2229',
          'line-strong': '#2a3038',
          ink: '#c8ced6',
          'ink-dim': '#6b7380',
          'ink-mute': '#4a5260',
          num: '#e8edf2',
          accent: '#f0a020',
          'accent-dim': '#a87018',
          ok: '#3dba7a',
          warn: '#e8a020',
          bad: '#e05454',
          idle: '#5a6270',
        },
        grid: {
          green: '#22c55e',
          yellow: '#eab308',
          red: '#ef4444',
          blue: '#3b82f6',
        },
      },
      fontFamily: {
        mono: ['"SF Mono"', '"IBM Plex Mono"', 'ui-monospace', '"Cascadia Mono"', 'Menlo', 'Consolas', 'monospace'],
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
