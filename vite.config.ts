import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const host = process.env.TAURI_DEV_HOST;

/**
 * pdf.js needs its cMaps (CJK CMap resources) and standard font data at
 * runtime URLs. They ship inside node_modules/pdfjs-dist but are not single
 * files Vite can rewrite via `new URL(..., import.meta.url)`, so we copy them
 * into `public/pdfjs/` where the dev server serves them and `vite build`
 * carries them into `dist/`. This keeps the app fully offline (no CDN fetch,
 * which the CSP would block anyway). The directory is gitignored; it is
 * regenerated on first dev/build after a clean clone.
 */
function pdfjsStaticAssets(): Plugin {
  const assets = ["cmaps", "standard_fonts"];
  const srcRoot = resolve(__dirname, "node_modules", "pdfjs-dist");
  const outRoot = resolve(__dirname, "public", "pdfjs");
  return {
    name: "mereth-pdfjs-static-assets",
    buildStart() {
      for (const asset of assets) {
        const from = resolve(srcRoot, asset);
        const to = resolve(outRoot, asset);
        if (existsSync(from) && !existsSync(to)) {
          cpSync(from, to, { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsStaticAssets()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
