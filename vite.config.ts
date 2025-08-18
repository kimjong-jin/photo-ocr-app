import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // mode에 맞는 환경변수 로드 (prefix: VITE_ 가 붙은 것만 클라이언트에 노출)
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      // 따로 process.env 주입할 필요 없이,
      // import.meta.env.VITE_XXX 로 접근하면 됩니다.
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
