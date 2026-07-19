/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed port; fail if not available
const host = process.env.TAURI_DEV_HOST;
// REGRESSION_MODE is set by `npm run test:regression`; when on, we
// include component tests in the suite (they're normally skipped to
// keep the unit test surface small).
const isRegression = process.env.REGRESSION_MODE === '1';

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring rust errors
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: isRegression
      ? ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}']
      : ['tests/**/*.test.{ts,tsx}'],
    reporters: 'default',
  },
});