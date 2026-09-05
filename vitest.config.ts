import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@engine': fileURLToPath(new URL('./src/engine', import.meta.url)),
      '@cards': fileURLToPath(new URL('./src/cards', import.meta.url)),
      '@net': fileURLToPath(new URL('./src/net', import.meta.url)),
      '@ui': fileURLToPath(new URL('./src/ui', import.meta.url)),
      '@sim': fileURLToPath(new URL('./src/sim', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
  },
});
