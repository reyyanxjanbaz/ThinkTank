/**
 * Think Tank brand mark.
 *
 * The mark is a pixel speech-bubble holding a five-bar voice waveform — five
 * colored bars centred on one line, tallest in the middle, one per council persona (devil, tyson,
 * bison, anshu, bucks, in that order), inside a lavender SNES-window bubble
 * with a talk-tail. It reads as "a room where five different voices argue",
 * which is the product, not just a badge.
 *
 * Concepts that were tried and dropped before this one (see the design
 * process notes handed off with this component): a fish-tank/aquarium
 * holding a brain, five seats around a round table seen from above, and a
 * pixel brain split into five colored lobes. The table degraded into a
 * generic flower/aperture at 16px; the tank and the brain both collapsed
 * into unreadable colored blobs at small sizes and didn't clear the "is
 * this ownable" bar. The bubble kept its silhouette all the way down to
 * 16px and is the only concept that encodes the product (a debate) rather
 * than just "AI + brain," which every other AI tool's mark already uses.
 *
 * Two hand-authored pixel grids back the mark:
 * - MARK_ROWS: a 24x24 grid used everywhere except the 16px favicon. Corner
 *   cuts and a diagonal tail survive fine once scaled, because SVG shapes
 *   are vector, not rasterized artwork.
 * - FAVICON_ROWS: a 16x16 grid, square-cornered, one art-pixel per CSS
 *   pixel at 16px. The 24-grid's corner chamfer and 2px border stop landing
 *   on integer device pixels at that size and soften into a blur; the
 *   16-grid sidesteps that by construction. See favicon.svg / FaviconMark.
 *
 * Both grids carry their own 1px "K" halo (color: brand deep #07082a, the
 * same "edge" tone used for window frames elsewhere in the app) dilated
 * from the mark's silhouette. On the dark app background the halo is
 * nearly invisible against it, which is the point: on a light favicon tray
 * or a white doc, it keeps the lavender frame from disappearing.
 */

type Run = { x: number; y: number; w: number; fill: string };

const PALETTE: Record<string, string> = {
  F: "#eceaff", // lavender frame
  D: "#07082a", // deep indigo — bubble interior + halo
  K: "#07082a",
  "1": "#ff5a5f", // Devil
  "2": "#ff9b3d", // Tyson
  "3": "#d9a36a", // Bison
  "4": "#6fe3c1", // Anshu
  "5": "#f7d046" // Bucks
};

// 24x24 grid: bubble + tail + five voice bars (devil..bucks, left to right).
// prettier-ignore
const MARK_ROWS: string[] = [
  "..KKKKKKKKKKKKKKKKKKKK..",
  ".KKFFFFFFFFFFFFFFFFFFKK.",
  "KKFFFFFFFFFFFFFFFFFFFFKK",
  "KFFKDDDDDDDDDDDDDDDDKFFK",
  "KFFDDDDDDDDDDDDDDDDDDFFK",
  "KFFDDDDDDDD33DDDDDDDDFFK",
  "KFFDDDDD22D33D44DDDDDFFK",
  "KFFDD11D22D33D44D55DDFFK",
  "KFFDD11D22D33D44D55DDFFK",
  "KFFDD11D22D33D44D55DDFFK",
  "KFFDD11D22D33D44D55DDFFK",
  "KFFDDDDD22D33D44DDDDDFFK",
  "KFFDDDDDDDD33DDDDDDDDFFK",
  "KFFDDDDDDDDDDDDDDDDDDFFK",
  "KFFKDDDDDDDDDDDDDDDDKFFK",
  "KKFFFFFFFFFFFFFFFFFFFFKK",
  ".KKFFFFFFFFFFFFFFFFFFKK.",
  "..KKFFKKKKKKKKKKKKKKKK..",
  ".KKFFKK.................",
  ".KFFKK..................",
  ".KKKK...................",
  "........................",
  "........................",
  "........................"
];

// 16x16 grid, square corners, used by favicon.svg / FaviconMark.
// prettier-ignore
const FAVICON_ROWS: string[] = [
  "FFFFFFFFFFFFFFFF",
  "FDDDDDDDDDDDDDDF",
  "FDDDDDD3DDDDDDDF",
  "FDDDD2D3D4DDDDDF",
  "FDD1D2D3D4D5DDDF",
  "FDD1D2D3D4D5DDDF",
  "FDD1D2D3D4D5DDDF",
  "FDDDD2D3D4DDDDDF",
  "FDDDDDD3DDDDDDDF",
  "FDDDDDDDDDDDDDDF",
  "FFFFFFFFFFFFFFFF",
  "KKFFKKKKKKKKKKKK",
  "KFFKK...........",
  "KKKK............",
  "................",
  "................"
];

function rowsToRuns(rows: readonly string[]): Run[] {
  const runs: Run[] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === key) end++;
      const fill = PALETTE[key];
      if (fill) runs.push({ x, y, w: end - x, fill });
      x = end;
    }
  }
  return runs;
}

const MARK_RUNS = rowsToRuns(MARK_ROWS);
const FAVICON_RUNS = rowsToRuns(FAVICON_ROWS);

function PixelSvg(props: {
  runs: Run[];
  grid: number;
  size: number;
  className?: string;
  title: string;
}): JSX.Element {
  const { runs, grid, size, className, title } = props;
  return (
    <svg
      className={className}
      // An empty title marks the logo as decorative (e.g. beside visible "Think Tank" text).
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      viewBox={`0 0 ${grid} ${grid}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", flexShrink: 0 }}
    >
      {runs.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}

/** The pixel mark alone: a speech bubble holding five colored voice-bars. */
export function LogoMark(props: { size?: number; className?: string; title?: string }): JSX.Element {
  const { size = 32, className, title = "Think Tank" } = props;
  return <PixelSvg runs={MARK_RUNS} grid={24} size={size} className={className} title={title} />;
}

/**
 * The 16x16-optimised variant used by favicon.svg. Exported in case a
 * caller wants the exact favicon art inline (e.g. an install prompt) at a
 * size other than 16 — it stays crisp at any multiple of its own grid.
 */
export function FaviconMark(props: { size?: number; className?: string; title?: string }): JSX.Element {
  const { size = 16, className, title = "Think Tank" } = props;
  return <PixelSvg runs={FAVICON_RUNS} grid={16} size={size} className={className} title={title} />;
}

/**
 * Mark + "Think Tank" wordmark. The wordmark is set in Jersey 10 (the
 * app's existing pixel display font, already loaded for every heading and
 * persona name) rather than drawn as pixel glyphs: Jersey 10 is itself a
 * pixel face, so hand-drawn letterforms would just be a worse-hinted copy
 * of a font the app already ships, at the cost of no longer reading as
 * real, selectable, accessible text.
 */
export function LogoLockup(props: { size?: number; className?: string }): JSX.Element {
  const { size = 32, className } = props;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(6, Math.round(size * 0.22))
      }}
    >
      <LogoMark size={size} />
      <span
        style={{
          fontFamily: '"Jersey 10", system-ui, sans-serif',
          fontSize: Math.round(size * 0.72),
          lineHeight: 1,
          color: "#eceaff",
          letterSpacing: "0.02em",
          whiteSpace: "nowrap"
        }}
      >
        Think Tank
      </span>
    </span>
  );
}
