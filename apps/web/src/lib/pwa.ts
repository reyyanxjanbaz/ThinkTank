import { useEffect, useState, useSyncExternalStore } from "react";

/*
  Installable-app plumbing, kept out of the components:
  - registers /sw.js in production builds (or in dev with VITE_ENABLE_SW=true);
  - reports a waiting update so the page can offer "reload" instead of swapping code mid-debate;
  - tracks online/offline;
  - keeps the app shell sized to the visual viewport so the on-screen keyboard never covers the composer.
*/

const swEnabled = import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === "true";

let waiting: ServiceWorker | null = null;
let applyUpdate: () => void = () => undefined;
const updateListeners = new Set<() => void>();
const announce = (worker: ServiceWorker) => {
  waiting = worker;
  updateListeners.forEach((listener) => listener());
};

export function registerServiceWorker(): void {
  if (!swEnabled || !("serviceWorker" in navigator)) return;

  // Reload only when the reader asked for the new version, never on the first install.
  let reloadOnSwap = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadOnSwap) return;
    reloadOnSwap = false;
    window.location.reload();
  });
  applyUpdate = () => {
    if (!waiting) return;
    reloadOnSwap = true;
    waiting.postMessage({ type: "SKIP_WAITING" });
  };

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        if (registration.waiting && navigator.serviceWorker.controller) announce(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const incoming = registration.installing;
          incoming?.addEventListener("statechange", () => {
            // With no controller this is the first install: nothing to update from.
            if (incoming.state === "installed" && navigator.serviceWorker.controller) announce(incoming);
          });
        });
        // Installed apps stay open for days; look for a new deploy whenever the app comes back.
        const check = () => void registration.update().catch(() => undefined);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.setInterval(check, 60 * 60 * 1000);
      })
      .catch(() => undefined);
  });
}

export function useUpdateReady(): [boolean, () => void] {
  const [ready, setReady] = useState(Boolean(waiting));
  useEffect(() => {
    const listener = () => setReady(true);
    updateListeners.add(listener);
    if (waiting) setReady(true);
    return () => {
      updateListeners.delete(listener);
    };
  }, []);
  return [ready, () => applyUpdate()];
}

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/*
  iOS Safari doesn't shrink the layout viewport (or 100dvh) when the keyboard opens, it scrolls
  the page under it instead. Mirror the visual viewport's height into --app-h so the shell ends
  right above the keyboard, and pin the page back to the top.
*/
export function trackVisualViewport(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const root = document.documentElement;
  let lastHeight = "";
  let lastKeyboard = false;
  // Only on resize (keyboard opening/closing, rotation), never on scroll: iOS scrolls the visual
  // viewport as the caret moves, and snapping that back on every keystroke made the screen jitter.
  const sync = () => {
    // Pinch-zoom also shrinks the visual viewport; only follow keyboard-driven changes.
    if (viewport.scale > 1.01) return;
    const height = `${Math.round(viewport.height)}px`;
    if (height !== lastHeight) {
      lastHeight = height;
      root.style.setProperty("--app-h", height);
    }
    // A big gap between layout and visual viewport means the on-screen keyboard is up.
    const keyboard = window.innerHeight - viewport.height > 120;
    if (keyboard !== lastKeyboard) {
      lastKeyboard = keyboard;
      if (keyboard) {
        root.dataset.keyboard = "open";
        // The shell now fits above the keyboard; undo the page shift iOS made to reveal the input, once.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      } else {
        delete root.dataset.keyboard;
      }
    }
  };
  viewport.addEventListener("resize", sync);
  sync();
}
