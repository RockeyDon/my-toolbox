import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    target: 'safari14',
    rollupOptions: { output: { manualChunks: (id) => /node_modules\/(?:@codemirror|@lezer|codemirror)\//.test(id) ? 'editor' : undefined } },
  },
  test: { include: ['src/**/*.test.ts'] },
});
