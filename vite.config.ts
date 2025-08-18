import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // mode에 맞는 환경변수 로드
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      // ✅ Vite 방식: import.meta.env.GEMINI_API_KEY 로 접근
      'import.meta.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});