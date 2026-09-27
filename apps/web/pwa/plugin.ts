import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/*
  Emits dist/sw.js from pwa/sw.js with this build's precache list baked in.
  Hand-rolled instead of vite-plugin-pwa to keep the dependency tree unchanged.
  In dev there is no worker unless VITE_ENABLE_SW=true (then a shell-only one is served).
*/
const template = () => readFileSync(fileURLToPath(new URL("./sw.js", import.meta.url)), "utf8");
const FONT_CSS = /https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]+/g;
// Public files worth having offline; og-image and the like are left to the network.
const PUBLIC_SHELL = ["manifest.webmanifest", "favicon.svg", "apple-touch-icon.png", "icon-192.png"];

const render = (version: string, precache: string[], fonts: string[]) =>
  template()
    .replace("__SW_VERSION__", JSON.stringify(version))
    .replace("__SW_PRECACHE__", JSON.stringify(precache))
    .replace("__SW_FONT_CSS__", JSON.stringify(fonts));

export default function serviceWorker(): Plugin {
  return {
    name: "thinktank-sw",
    configureServer(server) {
      if (process.env.VITE_ENABLE_SW !== "true") return;
      server.middlewares.use("/sw.js", (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.end(render(`dev-${Date.now()}`, ["./"], []));
      });
    },
    generateBundle(_options, bundle) {
      if (this.meta.watchMode) return;
      const files = Object.values(bundle)
        .map((item) => item.fileName)
        .filter((name) => name !== "index.html" && !name.endsWith(".map"))
        .sort();
      const fonts = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type === "asset" && item.fileName.endsWith(".css")) {
          for (const match of String(item.source).matchAll(FONT_CSS)) fonts.add(match[0].replace(/&amp;/g, "&"));
        }
      }
      const precache = ["./", ...PUBLIC_SHELL, ...files];
      const version = createHash("sha256").update(template()).update(precache.join("\n")).digest("hex").slice(0, 12);
      this.emitFile({ type: "asset", fileName: "sw.js", source: render(version, precache, [...fonts]) });
    }
  };
}
