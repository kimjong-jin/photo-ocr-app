// vite.config.ts
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  define: {
    // 어떤 서드파티가 process.env를 참조해도 크래시 나지 않게 안전망만 깔아둠
    'process.env': {},
  },
});
