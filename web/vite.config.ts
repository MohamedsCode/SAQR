import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { demoBus } from "./demoBus";

const sharedDir = fileURLToPath(new URL("../shared", import.meta.url));
const dataDir = fileURLToPath(new URL("../data", import.meta.url));
const modelDir = fileURLToPath(new URL("../engine/model", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), demoBus()],
  resolve: {
    alias: { "@shared": sharedDir, "@data": dataDir },
  },
  server: {
    port: 5173,
    // Listen on the LAN so a phone on the same Wi-Fi can open /demo/phone.
    host: true,
    fs: { allow: [".", sharedDir, dataDir, modelDir] },
    proxy: { "/api": "http://localhost:8000" },
  },
});
