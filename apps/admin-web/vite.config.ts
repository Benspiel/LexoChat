import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Same CSP as in production (deploy/caddy/Caddyfile) so that violations show up in dev and e2e tests.
const CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; " +
  "font-src 'self'; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const API = process.env.LEXICHAT_API ?? "http://127.0.0.1:8090";

// changeOrigin=false keeps the browser Origin header -> the server recognises the admin web app
const proxy = { "/api": { target: API, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
    target: "es2022",
    assetsInlineLimit: 0, // no data: urls for fonts/scripts
    // libsodium (WebAssembly) and the password blocklist are large, lazily loaded chunks
    chunkSizeWarningLimit: 600,
  },
  server: { port: 5173, strictPort: true, proxy },
  preview: {
    port: 4173,
    strictPort: true,
    proxy,
    headers: {
      "Content-Security-Policy": CSP,
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  },
});
