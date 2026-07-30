import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  base: '/docs/',
  build: {
    target: 'esnext',
    // Keep the URL prefix in the filesystem layout so Nginx can use a regular root + try_files.
    outDir: 'dist/docs',
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@src': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5174,
  },
});
