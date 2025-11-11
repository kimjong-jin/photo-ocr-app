// vite.config.ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        components: path.resolve(__dirname, 'src/components'),
        structural: path.resolve(__dirname, 'src/structural'),
        shared: path.resolve(__dirname, 'src/shared'),
        services: path.resolve(__dirname, 'src/services'),
        types: path.resolve(__dirname, 'src/types'),
      },
      dedupe: ['react', 'react-dom'],
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
    },
    // 클라이언트에서 읽을 환경변수 접두사
    envPrefix: ['VITE_', 'SENDER_', 'BREVO_'],
    server: {
      host: true,
      port: 5173,
      strictPort: true,
    },
    preview: {
      host: true,
      port: 4173,
    },
    build: {
      outDir: 'dist',
      target: 'es2020',
      sourcemap: true,
      rollupOptions: {
        onwarn(warning, warn) {
          // 불필요한 경고 무시 (원하면 제거)
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
          warn(warning);
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(env.npm_package_version ?? 'dev'),
    },
  };
});
