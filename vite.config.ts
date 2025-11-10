// vite.config.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { cwd } from 'node:process';

// Enable __dirname in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  // Load env for the current mode; only variables matching envPrefix are exposed to the client
  loadEnv(mode, cwd(), '');

  return {
    // Only expose variables that start with VITE_ to client code via import.meta.env
    envPrefix: ['VITE_'],

    define: {
      // No need to inject process.env.*. Use import.meta.env.VITE_* instead.
    },

    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },

    server: {
      proxy: {
        // vLLM CORS bypass proxy
        '/genai': {
          target: 'https://mobile.ktl.re.kr',
          changeOrigin: true,
          secure: true, // set to false only if you encounter self-signed certs in local dev
          rewrite: (p) => p.replace(/^\/genai/, '/genai/v1'),
        },
      },
    },
  };
});

