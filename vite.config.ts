import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // mode에 맞는 환경변수 로드
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      // process.env.* 따로 주입할 필요 없음
      // import.meta.env.VITE_XXX 로 바로 접근 가능
    },
    resolve: {
      alias: {
        // src 디렉토리를 @ 로 매핑
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      proxy: {
        // ✅ vLLM CORS 우회용 프록시 설정
        '/genai': {
          target: 'https://mobile.ktl.re.kr', // vLLM 서버 주소
          changeOrigin: true,
          secure: true, // HTTPS 인증서 검증 (내부망이므로 true 유지)
          rewrite: (path) => path.replace(/^\/genai/, '/genai/v1'),
        },
      },
    },
  };
});
