import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // relative asset paths so the build works from any folder or static host
  server: { host: true },
  build: { chunkSizeWarningLimit: 800 }, // three.js is one big chunk; fine for a prototype
});
