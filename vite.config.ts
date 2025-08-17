import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    define: {
      'process.env.VITE_API_KEY': JSON.stringify(env.VITE_API_KEY),
      'process.env.VITE_LOAD_TEMP_API_URL': JSON.stringify(env.VITE_LOAD_TEMP_API_URL),
      'process.env.VITE_SAVE_TEMP_API_URL': JSON.stringify(env.VITE_SAVE_TEMP_API_URL),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    base: './', // EXE 빌드 시 필수
  };
});

