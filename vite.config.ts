// vite.config.ts (또는 .js)
import { defineConfig, loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  // mode: 'development' | 'preview' | 'production' 등
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      __API_KEY__: JSON.stringify(env.VITE_API_KEY ?? ''),
      __LOAD_TEMP_API_URL__: JSON.stringify(env.VITE_LOAD_TEMP_API_URL ?? ''),
      __SAVE_TEMP_API_URL__: JSON.stringify(env.VITE_SAVE_TEMP_API_URL ?? ''),
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src') },
    },
    base: './',
  };
});
