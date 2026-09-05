import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@cards': fileURLToPath(new URL('./src/cards', import.meta.url)),
      '@net': fileURLToPath(new URL('./src/net', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
    },
  },
  server: { port: 5173 },
});
