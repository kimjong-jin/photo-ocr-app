import { defineConfig, loadEnv } from 'vite';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    define: {
      'import.meta.env.VITE_API_KEY': JSON.stringify(env.VITE_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
