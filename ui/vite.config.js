import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Built output lands in src/ui/dist, which the server serves under /ui.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: '../src/ui/dist', emptyOutDir: true },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
});
