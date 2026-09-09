import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { relayMiddleware } from './src/relay/devMiddleware';

/**
 * Serve the relay in dev and preview. Without it `npm run dev` has no `/api`,
 * so two browsers cannot talk and multiplayer is only testable by deploying.
 */
function relayPlugin(): PluginOption {
  return {
    name: 'jlore-relay',
    configureServer(server) {
      server.middlewares.use(relayMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(relayMiddleware());
    },
  };
}

export default defineConfig({
  plugins: [react(), relayPlugin()],
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
