/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Para dev local: el api del backend corre por defecto en :3000.
      // Cambia VITE_API_BASE_URL en .env si lo tienes en otro puerto.
      '/api': {
        target: process.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
    // El default (5 s) era ajustado para tests que disparan muchas
    // interacciones `userEvent.type/click` seguidas en jsdom. Bajo carga
    // concurrente de CPU (el pre-push corre build + lint + typecheck antes
    // de los tests; CI hace algo similar) el thread de Node se ralentiza
    // lo suficiente como para que cadenas de ~10 interacciones excedan los
    // 5 s. 15 s da margen ~3x sin enmascarar tests genuinamente lentos.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
