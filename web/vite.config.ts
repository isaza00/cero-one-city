import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FE runs natively on Windows (PowerShell); the backend runs in containers
// under WSL2. WS proxying needs an http target + ws:true for the upgrade.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "http://localhost:8000", ws: true, changeOrigin: true },
    },
  },
});
