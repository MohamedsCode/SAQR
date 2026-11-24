import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type UserConfig } from "vite";

const sharedDir = fileURLToPath(new URL("../shared", import.meta.url));

// Content scripts cannot be ES modules, so each entry is built on its own as one self-contained IIFE file.
const ENTRIES: Record<string, string> = {
  background: "src/background.ts",
  content: "src/content.tsx",
};

function brandIcons(): Plugin {
  return {
    name: "saqr-brand-icons",
    generateBundle() {
      for (const size of [16, 32, 48, 128]) {
        this.emitFile({
          type: "asset",
          fileName: `icons/icon-${size}.png`,
          source: readFileSync(`${sharedDir}/logo/icons/icon-${size}.png`),
        });
      }
    },
  };
}

export default defineConfig(({ mode }): UserConfig => {
  const base: UserConfig = {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@shared": sharedDir } },
    server: { port: 5175, fs: { allow: [".", sharedDir] } },
  };
  const entry = ENTRIES[mode];
  if (!entry) return base; // `npm run dev` serves the local preview (index.html)
  return {
    ...base,
    plugins: [...(base.plugins ?? []), ...(mode === "background" ? [brandIcons()] : [])],
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    publicDir: mode === "background" ? "public" : false,
    build: {
      outDir: "dist",
      emptyOutDir: mode === "background",
      assetsInlineLimit: 1_000_000,
      lib: { entry, formats: ["iife"], name: `saqr_${mode}`, fileName: () => `${mode}.js` },
    },
  };
});
