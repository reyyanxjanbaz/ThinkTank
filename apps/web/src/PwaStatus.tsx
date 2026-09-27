import { useState } from "react";
import { useOnline, useUpdateReady } from "./lib/pwa";

/*
  The app's two connection notes, stacked at the top edge under the notch:
  - offline: a quiet chip, gone again the moment the connection returns;
  - update: a new build has been downloaded; it only takes over when the reader taps Reload,
    so a debate is never cut off mid-stream.
*/
export default function PwaStatus() {
  const online = useOnline();
  const [updateReady, applyUpdate] = useUpdateReady();
  const [dismissed, setDismissed] = useState(false);
  const showUpdate = updateReady && !dismissed;

  if (online && !showUpdate) return null;

  return (
    <div className="pwa-status">
      {!online && (
        <p className="pwa-chip" role="status">
          <span className="pwa-dot" aria-hidden="true" />
          Offline
        </p>
      )}
      {showUpdate && (
        <div className="pwa-toast" role="status">
          <span>New version ready</span>
          <button type="button" className="pwa-toast-reload" onClick={applyUpdate}>
            Reload
          </button>
          <button type="button" className="pwa-toast-close" aria-label="Not now" onClick={() => setDismissed(true)}>
            <svg viewBox="0 0 7 7" width="9" height="9" shapeRendering="crispEdges" aria-hidden="true">
              <path d="M0 0h1v1h1v1h1v1h1V2h1V1h1V0h1v1H6v1H5v1H4v1h1v1h1v1h1v1H6V6H5V5H4V4H3v1H2v1H1v1H0V6h1V5h1V4h1V3H2V2H1V1H0z" fill="currentColor" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
