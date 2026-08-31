import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// FE corre nativo en Windows (PowerShell); el backend corre en contenedores bajo WSL2.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
