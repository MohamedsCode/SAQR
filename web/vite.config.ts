import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const sharedDir = fileURLToPath(new URL("../shared", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@shared": sharedDir },
  },
  server: {
    port: 5173,
    fs: { allow: [".", sharedDir] },
    proxy: { "/api": "http://localhost:8000" },
  },
});
