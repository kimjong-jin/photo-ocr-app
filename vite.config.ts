// vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { cwd } from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), ''); // VITE_ 접두사 포함 모두 로드(클라이언트 노출은 VITE_만)

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    // 개발 중 내부 vLLM 프록시(필요 없으면 제거)
    server: {
      proxy: {
        '/genai': {
          target: 'https://mobile.ktl.re.kr',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/genai/, '/genai/v1'),
        },
      },
    },
    define: {
      // 클라이언트에서 사용할 키는 반드시 VITE_만. import.meta.env.VITE_XXX 로 접근
      'import.meta.env.VITE_API_KEY': JSON.stringify(env.VITE_API_KEY),
      'import.meta.env.VITE_KAKAO_JS_KEY': JSON.stringify(env.VITE_KAKAO_JS_KEY),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY),
    },
  };
});
