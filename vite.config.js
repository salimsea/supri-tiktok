import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
