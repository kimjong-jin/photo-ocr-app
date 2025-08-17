import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  define: {
    __API_KEY__: JSON.stringify(import.meta.env.VITE_API_KEY),
    __LOAD_TEMP_API_URL__: JSON.stringify(import.meta.env.VITE_LOAD_TEMP_API_URL),
    __SAVE_TEMP_API_URL__: JSON.stringify(import.meta.env.VITE_SAVE_TEMP_API_URL),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  base: './',
});
