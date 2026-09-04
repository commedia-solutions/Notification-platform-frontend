import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const apiTarget =
    env.DEV_API_PROXY_TARGET || "https://signalops-api.iot-cspllabs.com";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          secure: true,
          // The browser sees this as a same-origin development request. An
          // empty upstream Origin keeps localhost out of production CORS.
          headers: { origin: "" },
        },
      },
    },
  };
});
