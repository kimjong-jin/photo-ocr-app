import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // mode에 맞는 환경변수 로드
  // VITE_ 접두사가 붙은 환경변수만 클라이언트에서 접근 가능
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      // process.env.* 따로 주입할 필요 없음
      // import.meta.env.VITE_XXX 로 바로 접근 가능
    },
    resolve: {
      alias: {
        // src 디렉토리를 @ 로 매핑
        // 예: import AnalysisPage from '@/components/analysis/AnalysisPage'
        '@': path.resolve(__dirname, 'src'),
      },
    },
  };
});
