import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Vite 환경변수 로딩
  const env = loadEnv(mode, process.cwd());  // 주의: process.cwd() 사용해야 .env.local 읽힘

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // 환경변수는 import.meta.env.VITE_ 접두사를 통해 자동 노출됨 (define 불필요)
  };
});
