// vite.config.ts
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  base: './',
  server: {
    hmr: { overlay: false }, // ✅ 에러 오버레이 끄기
  },
});
