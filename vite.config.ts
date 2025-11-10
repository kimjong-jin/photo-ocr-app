// vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { cwd } from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // .env.* 로드 (VITE_ 접두사만 클라이언트에 노출)
  const env = loadEnv(mode, cwd(), '');

  // 선택: VITE_ 변수만 빌드타임 상수화 (import.meta.env.VITE_xxx)
  const viteEnvDefines = Object.fromEntries(
    Object.entries(env)
      .filter(([k]) => k.startsWith('VITE_'))
      .map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)])
  );

  return {
    define: {
      ...viteEnvDefines,
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    server: {
      proxy: {
        /**
         * DEV 전용 프록시
         * - 개발: 클라이언트에서 '/genai/xxx' 로 호출 → 프록시가 https://mobile.ktl.re.kr/genai/v1/xxx 로 전달
         * - 운영: 절대 URL(예: VITE_GENAI_BASE_URL) 사용 권장. 개발 주소와 중복 'v1' 방지.
         */
        '/genai': {
          target: 'https://mobile.ktl.re.kr',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/genai/, '/genai/v1'),
        },
      },
    },
  };
});
