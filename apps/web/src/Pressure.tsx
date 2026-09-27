import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { MODES } from "./lib/council";
import { commandForMode } from "./lib/tokens";
import "./pressure.css";

/**
 * "Pressure" is how hard the council pushes: the session mode, shown as heat.
 * Levels run from open brainstorm to hostile audit, and the heat ramp borrows
 * the persona hues from cool (Anshu mint) to hot (Devil red).
 */
export const PRESSURE = [
  { mode: "Brainstorm", level: 1, heat: "#6fe3c1", name: "Open floor" },
  { mode: "Co-Founder", level: 2, heat: "#f7d046", name: "Warm" },
  { mode: "Shark Tank", level: 3, heat: "#ff9b3d", name: "Hot seat" },
  { mode: "Devils Court", level: 4, heat: "#ff5a5f", name: "Trial by fire" }
] as const;

type PressureStop = (typeof PRESSURE)[number];

export const pressureFor = (mode: string): PressureStop =>
  PRESSURE.find((stop) => stop.mode === mode) ?? PRESSURE[0];

const heatStyle = (stop: PressureStop) =>
  ({ "--heat": stop.heat, "--level": stop.level }) as CSSProperties;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------- Pixel gauge ----------

const GAUGE_W = 48;
const GAUGE_H = 27;
const CX = 23.5;
const CY = 25;
const DIM = "#232873";

type Px = { x: number; y: number; fill: string };

// Arc pixels, one zone per pressure level, with a small gap between zones.
const arcPixels = (level: number): Px[] => {
  const pixels: Px[] = [];
  for (let y = 0; y < GAUGE_H; y += 1) {
    for (let x = 0; x < GAUGE_W; x += 1) {
      const dx = x + 0.5 - CX;
      const dy = CY - (y + 0.5);
      if (dy < 0) continue;
      const distance = Math.hypot(dx, dy);
      if (distance < 15.5 || distance > 22.5) continue;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const fromLeft = 180 - angle;
      const zone = Math.min(3, Math.floor(fromLeft / 45));
      const intoZone = fromLeft - zone * 45;
      if (intoZone < 2.5 || intoZone > 42.5) continue;
      const outerRim = distance > 21.2;
      const stop = PRESSURE[zone];
      const lit = zone < level;
      pixels.push({
        x,
        y,
        fill: lit ? (outerRim ? "#ffffff" : stop.heat) : outerRim ? "#2c3285" : DIM
      });
    }
  }
  return pixels;
};

// Needle as pixels sampled along a line from the pivot.
const needlePixels = (angle: number): Px[] => {
  const radians = (angle * Math.PI) / 180;
  const seen = new Set<string>();
  const pixels: Px[] = [];
  for (let r = 2; r <= 17; r += 0.35) {
    const px = CX + Math.cos(radians) * r;
    const py = CY - Math.sin(radians) * r;
    // Two pixels wide so the reading holds up at small sizes.
    for (const [ox, oy] of [
      [0, 0],
      [Math.abs(Math.sin(radians)) > 0.5 ? 1 : 0, Math.abs(Math.sin(radians)) > 0.5 ? 0 : 1]
    ]) {
      const x = Math.floor(px) + ox;
      const y = Math.floor(py) - oy;
      const key = `${x},${y}`;
      if (seen.has(key) || y > CY) continue;
      seen.add(key);
      pixels.push({ x, y, fill: "#eceaff" });
    }
  }
  return pixels;
};

const levelAngle = (level: number) => 180 - (level - 0.5) * 45;

function Gauge({ level }: { level: number }) {
  const target = levelAngle(level);
  const [angle, setAngle] = useState(target);
  const angleRef = useRef(target);

  // The needle swings in visible steps, like a real dial settling.
  useEffect(() => {
    if (prefersReducedMotion()) {
      angleRef.current = target;
      setAngle(target);
      return;
    }
    const timer = window.setInterval(() => {
      const current = angleRef.current;
      const delta = target - current;
      if (Math.abs(delta) < 0.5) {
        window.clearInterval(timer);
        return;
      }
      const next = current + Math.sign(delta) * Math.min(Math.abs(delta), 9);
      angleRef.current = next;
      setAngle(next);
    }, 32);
    return () => window.clearInterval(timer);
  }, [target]);

  const arc = useMemo(() => arcPixels(level), [level]);
  const needle = needlePixels(angle);

  return (
    <svg
      className="gauge-svg"
      viewBox={`0 0 ${GAUGE_W} ${GAUGE_H}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {arc.map((p) => (
        <rect key={`a${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
      ))}
      {needle.map((p) => (
        <rect key={`n${p.x},${p.y}`} x={p.x} y={p.y} width={1} height={1} fill={p.fill} />
      ))}
      <rect x={22} y={23} width={3} height={3} fill="#eceaff" />
      <rect x={23} y={24} width={1} height={1} fill="#07082a" />
    </svg>
  );
}

// ---------- Heat pips (1 to 4 ascending bars) ----------

export function HeatBars({ level, className = "" }: { level: number; className?: string }) {
  return (
    <span className={`heat-bars ${className}`} aria-hidden="true">
      {PRESSURE.map((stop) => (
        <i key={stop.level} data-on={stop.level <= level} style={{ "--bar-heat": stop.heat } as CSSProperties} />
      ))}
    </span>
  );
}

// ---------- Level picker (radio group with arrow keys) ----------

function Stops({
  mode,
  onChange,
  layout
}: {
  mode: string;
  onChange: (mode: string) => void;
  layout: "row" | "grid";
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = pressureFor(mode);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(PRESSURE.length - 1, current.level - 1 + step));
    onChange(PRESSURE[index].mode);
    refs.current[index]?.focus();
  };

  return (
    <div
      className={`pressure-stops pressure-stops-${layout}`}
      role="radiogroup"
      aria-label="Pressure"
      onKeyDown={handleKeyDown}
    >
      {PRESSURE.map((stop, index) => {
        const checked = stop.mode === current.mode;
        return (
          <button
            key={stop.mode}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="pressure-stop"
            style={heatStyle(stop)}
            onClick={() => onChange(stop.mode)}
          >
            <HeatBars level={stop.level} />
            <span className="stop-text">
              <strong>{stop.mode}</strong>
              <span>{stop.name}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Public control ----------

type Variant = "dial" | "panel" | "compact";

export function PressureControl({
  variant,
  mode,
  onChange
}: {
  variant: Variant;
  mode: string;
  onChange: (mode: string) => void;
}) {
  const stop = pressureFor(mode);
  const details = MODES.find((item) => item.name === stop.mode);

  if (variant === "compact") {
    return <CompactPressure mode={mode} onChange={onChange} />;
  }

  return (
    <div className={`pressure pressure-${variant}`} style={heatStyle(stop)} data-level={stop.level}>
      <div className="pressure-readout">
        <div className="gauge" data-level={stop.level}>
          <Gauge level={stop.level} />
          {stop.level === 4 && (
            <span className="steam" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        <div className="readout-text" aria-live="polite">
          <span className="readout-level">
            Pressure {stop.level} of {PRESSURE.length}
          </span>
          <strong className="readout-name">{stop.name}</strong>
          <span className="readout-mode">{stop.mode}</span>
        </div>
      </div>
      <Stops mode={mode} onChange={onChange} layout="grid" />
      {variant === "dial" && details && <p className="pressure-desc">{details.description}</p>}
      {variant === "panel" && details && <p className="pressure-ritual">{details.ritual}</p>}
    </div>
  );
}

function CompactPressure({ mode, onChange }: { mode: string; onChange: (mode: string) => void }) {
  const stop = pressureFor(mode);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | globalThis.KeyboardEvent) => {
      if (event instanceof MouseEvent) {
        if (wrapRef.current?.contains(event.target as Node)) return;
      } else if (event.key !== "Escape") {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="pressure-compact" ref={wrapRef} style={heatStyle(stop)}>
      <button
        type="button"
        className="pressure-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Pressure: ${stop.name}, ${stop.mode}. Change pressure`}
        onClick={() => setOpen((value) => !value)}
      >
        <HeatBars level={stop.level} />
        <span className="trigger-name">{stop.mode}</span>
      </button>
      {open && (
        <div className="pressure-popover" role="dialog" aria-label="Set the pressure">
          {/* The same dial as the welcome screen: one pressure control, shown in two places. */}
          <PressureControl variant="dial" mode={mode} onChange={onChange} />
          <p className="pressure-tip">
            Or start a message with{" "}
            {PRESSURE.map((stop, index) => (
              <span key={stop.mode}>
                {index > 0 && " "}
                <kbd style={heatStyle(stop)}>/{commandForMode(stop.mode)?.word}</kbd>
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  );
}

// A thin heat strip for the room: how hot the conversation is set to run.
export function PressureStrip({ mode }: { mode: string }) {
  const stop = pressureFor(mode);
  return (
    <div className="pressure-strip" style={heatStyle(stop)} data-level={stop.level} aria-hidden="true">
      <span />
    </div>
  );
}
