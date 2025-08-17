import { defineConfig, loadEnv } from "vite";
import path from "path";

export default defineConfig(({ mode }) => {
  // `loadEnv`를 사용하지 않아도 `import.meta.env`로 접근 가능합니다.
  // const env = loadEnv(mode, process.cwd(), ""); 

  return {
    // define 속성 제거 - `import.meta.env`를 사용합니다.
    // define: {
    //   __API_KEY__: JSON.stringify(env.VITE_API_KEY ?? ""),
    //   __LOAD_TEMP_API_URL__: JSON.stringify(env.VITE_LOAD_TEMP_API_URL ?? ""),
    //   __SAVE_TEMP_API_URL__: JSON.stringify(env.VITE_SAVE_TEMP_API_URL ?? ""),
    // },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    base: "./",
  };
});
