import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedDir = fileURLToPath(new URL("../shared", import.meta.url));
const dataDir = fileURLToPath(new URL("../data", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": sharedDir, "@data": dataDir },
  },
  server: {
    port: 5173,
    fs: { allow: [".", sharedDir, dataDir] },
    proxy: { "/api": "http://localhost:8000" },
  },
});
