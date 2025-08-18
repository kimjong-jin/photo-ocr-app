import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ''); // .env.local 불러오기

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    define: {
      __API_KEY__: JSON.stringify(env.VITE_API_KEY),
      __SAVE_URL__: JSON.stringify(env.VITE_SAVE_TEMP_API_URL),
      __LOAD_URL__: JSON.stringify(env.VITE_LOAD_TEMP_API_URL),
    },
  };
});

