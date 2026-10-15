import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createApiProxy } from "./server/api-proxy";

export default defineConfig(({ mode, command }) => {
  // Sem prefixo VITE_: estes valores ficam exclusivamente no servidor.
  const env = loadEnv(mode, ".", "STAYPULSE_");
  const proxy =
    command === "serve"
      ? createApiProxy(
          env.STAYPULSE_API_URL || "http://127.0.0.1:3000",
          env.STAYPULSE_API_KEY || "",
        )
      : {};
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", cors: false, proxy },
    preview: { host: "127.0.0.1", cors: false, proxy },
  };
});
