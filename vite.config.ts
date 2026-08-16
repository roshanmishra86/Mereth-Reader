import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
 *
 * The copy is keyed on the installed pdfjs-dist version via a `.version`
 * stamp file written into `public/pdfjs/` after copying: re-copy whenever the
 * stamp is missing or doesn't match, so a pdfjs-dist upgrade doesn't leave
 * stale cmaps/fonts silently mismatched with the runtime library. Otherwise
 * (stamp matches) skip — the copy is ~2MB and buildStart runs on every build.
 */
function pdfjsStaticAssets(): Plugin {
  const assets = ["cmaps", "standard_fonts"];
  const srcRoot = resolve(__dirname, "node_modules", "pdfjs-dist");
  const outRoot = resolve(__dirname, "public", "pdfjs");
  const versionStamp = resolve(outRoot, ".version");
  return {
    name: "mereth-pdfjs-static-assets",
    buildStart() {
      const pkgPath = resolve(srcRoot, "package.json");
      if (!existsSync(pkgPath)) return;
      const { version } = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };

      const stampedVersion = existsSync(versionStamp) ? readFileSync(versionStamp, "utf-8").trim() : null;
      if (stampedVersion === version) return;

      for (const asset of assets) {
        const from = resolve(srcRoot, asset);
        const to = resolve(outRoot, asset);
        if (existsSync(from)) {
          cpSync(from, to, { recursive: true });
        }
      }
      writeFileSync(versionStamp, version);
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
