import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Point at the dev API server; override when it runs on a non-default port:
//   VITE_API_TARGET=http://localhost:4100 pnpm dev
const apiTarget = process.env.VITE_API_TARGET ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Shared, browser-safe server modules (e.g. the password policy).
    alias: { "@server": fileURLToPath(new URL("../server/src", import.meta.url)) },
  },
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
});
