// vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { cwd } from 'node:process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, cwd(), '');

  // 선택사항: VITE_만 define에 넣어 빌드타임 상수화
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
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        // DEV 전용: /genai → https://mobile.ktl.re.kr/genai/v1
        // 서비스 코드가 dev 에서는 '/genai/xxx', prod 에서는 환경변수 기반 절대 URL 사용하도록!
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
