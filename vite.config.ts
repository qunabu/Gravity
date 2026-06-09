import { defineConfig } from 'vite';

// Served at the root in dev, and under /Gravity/ on GitHub Pages.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/Gravity/' : '/',
  server: { port: 5173, open: true },
  build: { target: 'es2022' },
}));
