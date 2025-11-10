// vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { cwd } from 'node:process';

// ESM용 __dirname
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // .env.* 로드 (클라이언트 노출은 VITE_ 접두사만)
  const env = loadEnv(mode, cwd(), '');

  // (선택) VITE_ 변수만 define에 주입해 import.meta.env.VITE_XXX가 빌드 타임에 확정되도록
  const viteEnvDefines = Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => k.startsWith('VITE_'))
      .map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])
  );

  return {
    define: {
      ...viteEnvDefines,
      // process.env.* 주입/폴리필 불필요. (클라 코드에서는 import.meta.env.VITE_XXX 사용)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        // ✅ vLLM CORS 우회 프록시 (필요 없으면 삭제)
        '/genai': {
          target: 'https://mobile.ktl.re.kr',
          changeOrigin: true,
          secure: true,               // 내부망 인증서 문제 있으면 임시로 false 테스트
          rewrite: (p) => p.replace(/^\/genai/, '/genai/v1'),
        },
      },
    },
  };
});
