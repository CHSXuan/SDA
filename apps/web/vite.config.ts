import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  // The desktop shell loads the production bundle through file://.
  // Relative URLs keep assets working in both Vite and Electron.
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    // The wasm glue is already plain ESM; leave it (and its .wasm) alone.
    exclude: ["@sda/core"],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        performance: resolve(__dirname, "performance.html"),
      },
    },
  },
  server: {
    port: 4176,
  },
});
