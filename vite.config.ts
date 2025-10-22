// vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { cwd } from 'node:process';

// ESM에서도 __dirname 사용 가능하게 처리
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // mode에 맞는 환경변수 로드
  // 세 번째 인자 '' -> VITE_ 접두사 없는 것도 로드하지만,
  // 실제 클라이언트 노출은 VITE_ 변수만 노출됨
  const env = loadEnv(mode, cwd(), '');

  return {
    define: {
      // process.env.* 따로 주입할 필요 없음
      // import.meta.env.VITE_XXX 로 바로 접근
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        // ✅ vLLM CORS 우회용 프록시
        '/genai': {
          target: 'https://mobile.ktl.re.kr', // vLLM 서버 주소
          changeOrigin: true,
          secure: true, // 내부망 인증서면 true 유지. (문제 시 false로 테스트)
          rewrite: (p) => p.replace(/^\/genai/, '/genai/v1'),
        },
      },
    },
  };
});
