import { defineConfig } from 'vite';

// Served at the root in dev, and under /Gravity/ on GitHub Pages. `preview`
// resolves config with command 'serve', so it needs the built base spelled out
// too — otherwise it serves dist at / while the HTML asks for /Gravity/ assets.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/Gravity/' : '/',
  server: { port: 5173, open: true },
  build: { target: 'es2022' },
}));
