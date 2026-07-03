import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Point at the dev API server; override when it runs on a non-default port:
//   VITE_API_TARGET=http://localhost:4100 pnpm dev
const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
});
