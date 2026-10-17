import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In the Tauri build the server url is fixed at build time (VITE_LEXICHAT_SERVER) and the CSP
// comes from src-tauri/tauri.conf.json. For development and the browser based e2e tests the
// api is proxied (same origin) and the same CSP is sent by the preview server.
const API = process.env.LEXICHAT_API ?? "http://127.0.0.1:8090";
const proxy = { "/api": { target: API, changeOrigin: false, ws: false } };
const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; " +
  "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: { sourcemap: false, target: "es2022", assetsInlineLimit: 0, chunkSizeWarningLimit: 600 },
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 4174, strictPort: true, proxy, headers: { "Content-Security-Policy": CSP, "X-Frame-Options": "DENY" } },
});
