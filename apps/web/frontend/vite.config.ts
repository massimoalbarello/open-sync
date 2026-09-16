import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '#backend/lib/runtime-config.ts';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: { outDir: fileURLToPath(new URL('../dist/public', import.meta.url)), emptyOutDir: true },
  server: {
    port: Number(process.env.FRONTEND_PORT ?? DEFAULT_FRONTEND_PORT),
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${process.env.PORT ?? DEFAULT_BACKEND_PORT}` },
      '/openapi': { target: `http://localhost:${process.env.PORT ?? DEFAULT_BACKEND_PORT}` },
    },
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: 'react',
      routesDirectory: fileURLToPath(new URL('./src/routes', import.meta.url)),
      generatedRouteTree: fileURLToPath(new URL('./src/routeTree.gen.ts', import.meta.url)),
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
