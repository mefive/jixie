import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// `@src` 别名是框架 lib 与约定的硬依赖。
// main.tsx 顶层 await authStore.load() 用了 top-level await → build.target 需 esnext。
export default defineConfig({
  build: { target: 'esnext' },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@src': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // 后端 api 在 3001（避开 marginalia / fangtu 的 3000）
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
