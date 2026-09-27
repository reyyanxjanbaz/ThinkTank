import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import serviceWorker from "./pwa/plugin";

export default defineConfig(({ command, mode }) => {
  // A production build without VITE_API_URL can only reach an API on its own origin.
  if (command === "build") {
    const env = loadEnv(mode, process.cwd(), "VITE_");
    if (!env.VITE_API_URL?.trim()) {
      console.warn(
        "\n[thinktank] VITE_API_URL is not set: the built app will call the API on its own origin. Set it to the deployed API URL.\n"
      );
    }
  }

  return {
    plugins: [react(), serviceWorker()],
    preview: {
      port: 4173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true
        },
        "/health": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true
        }
      }
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true
        },
        "/health": {
          target: "http://127.0.0.1:3001",
          changeOrigin: true
        }
      }
    }
  };
});
