import { useEffect, useState } from "react";
import { personaStyle } from "./lib/council";

/**
 * The room's floor, lit from above by the pressure and from below by whoever holds the floor.
 * Pure decoration: two empty layers painted by decor.css, behind everything, never hit-tested.
 * The aura is keyed on the speaker so each new voice fades its own light in; the last speaker's
 * colour is kept so the light fades out in that colour instead of snapping to white.
 */
export function RoomDecor({ speaker }: { speaker: string | null }) {
  const [tint, setTint] = useState(speaker);

  useEffect(() => {
    if (speaker) setTint(speaker);
  }, [speaker]);

  return (
    <>
      <div className="room-decor" aria-hidden="true" />
      <div
        key={tint ?? "none"}
        className="room-aura"
        aria-hidden="true"
        data-on={Boolean(speaker)}
        style={tint ? personaStyle(tint) : undefined}
      />
    </>
  );
}
