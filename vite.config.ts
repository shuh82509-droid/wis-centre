import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    target: "es2020",
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "vendor-react";
          if (id.includes("node_modules/@fluentui")) return "vendor-fluent";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4318,
  },
  preview: {
    host: "127.0.0.1",
    port: 4319,
  },
});
