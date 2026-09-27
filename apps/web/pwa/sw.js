/*
  Think Tank service worker. Built into dist/sw.js by pwa/plugin.ts, which fills in
  the version, the precache list (index.html + every hashed asset of this build) and
  the Google Fonts stylesheet URLs.

  - App shell: precached at install, cache-first. Navigations are network-first and fall
    back to the cached shell, so a fresh deploy is always picked up when online and an old
    worker can never pin people to stale HTML.
  - Google Fonts: stylesheet stale-while-revalidate, font files cache-first.
  - Everything else (/api, streams, /health, Supabase, any cross-origin call) is not touched:
    it goes straight to the network and is never cached.
  - A new version waits until the page asks it to take over (the "reload" toast).
*/
const VERSION = __SW_VERSION__;
const PRECACHE = __SW_PRECACHE__;
const FONT_CSS = __SW_FONT_CSS__;

const SHELL_CACHE = `thinktank-shell-${VERSION}`;
const FONT_CACHE = "thinktank-fonts-v1";
const SCOPE = new URL(self.registration.scope);
const SHELL_URL = SCOPE.href; // the scope root serves index.html; hash routing means every screen is this one document
const PRECACHED = new Set(PRECACHE.map((path) => new URL(path, SCOPE).href));
const NETWORK_ONLY = [/^\/api(\/|$)/, /^\/health(\/|$)/, /^\/auth(\/|$)/, /^\/rest(\/|$)/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE);
      await shell.addAll([...PRECACHED]);
      // Fonts are best-effort: an install must not fail because Google Fonts was slow.
      await warmFonts().catch(() => undefined);
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("thinktank-shell-") && key !== SHELL_CACHE)
          .map((key) => caches.delete(key))
      );
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    const path = url.pathname.slice(SCOPE.pathname.length - 1);
    if (NETWORK_ONLY.some((pattern) => pattern.test(path))) return;
    if (request.headers.get("accept")?.includes("text/event-stream")) return;
    if (request.mode === "navigate") {
      event.respondWith(networkFirstShell(request));
      return;
    }
    if (PRECACHED.has(url.href) || url.pathname.startsWith(`${SCOPE.pathname}assets/`)) {
      event.respondWith(cacheFirst(request, SHELL_CACHE));
    }
    return;
  }

  if (url.origin === "https://fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }
  if (url.origin === "https://fonts.gstatic.com") {
    event.respondWith(cacheFirst(request, FONT_CACHE));
  }
});

async function networkFirstShell(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  const fresh = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? fresh;
}

// Pull the Google Fonts stylesheet and the font files it points at into the cache now,
// so the first offline launch already has the pixel type.
async function warmFonts() {
  const cache = await caches.open(FONT_CACHE);
  await Promise.all(
    FONT_CSS.map(async (href) => {
      const response = await fetch(href);
      if (!response.ok) return;
      const css = await response.clone().text();
      await cache.put(href, response);
      const files = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((match) => match[1]);
      await Promise.all(
        files.map(async (file) => {
          if (await cache.match(file)) return;
          const font = await fetch(file);
          if (font.ok) await cache.put(file, font);
        })
      );
    })
  );
}
