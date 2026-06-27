import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// `@src` 别名是框架 lib 与约定的硬依赖。
// main.tsx 顶层 await authStore.load() 用了 top-level await → build.target 需 esnext。
export default defineConfig({
  build: { target: 'esnext' },
  plugins: [react(), tailwindcss()],
  // Pre-bundle echarts' sub-path imports together so the tree-shaken core/charts/components share ONE
  // instance. Otherwise an incremental re-optimize (e.g. after adding a dep) can split core into an app
  // chunk while charts stays an optimized dep → two echarts → "Invalid data provider." on chart init.
  optimizeDeps: {
    include: ['echarts/core', 'echarts/charts', 'echarts/components', 'echarts/renderers'],
  },
  resolve: {
    alias: { '@src': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // 后端 api 在 3001（避开 marginalia / fangtu 的 3000）
    proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: true } },
  },
});
