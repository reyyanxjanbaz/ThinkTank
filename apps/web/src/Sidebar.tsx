import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Session } from "./lib/types";
import { FALLBACK_PERSONAS } from "./lib/council";
import { LogoMark } from "./Logo";
import { HeatBars, pressureFor } from "./Pressure";
import { PersonaSprite } from "./sprites";
import "./sidebar.css";

type SidebarProps = {
  sessions: Session[];
  sessionsStatus: string;
  currentId: string | null;
  /** True while a round is streaming; switching councils then would mix replies into the wrong one. */
  busy: boolean;
  isOpen: boolean;
  collapsed: boolean;
  requiresAuth: boolean;
  identity: string;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onHome: () => void;
  onNewCouncil: () => void;
  onOpen: (session: Session) => void;
  onRefresh: () => void;
  onRename: (id: string, title: string) => void;
  onSignOut: () => void;
};

const PIN_KEY = "tt-pinned-councils";
const pinKeyFor = (identity: string) => `${PIN_KEY}:${identity || "local"}`;
const LOADING_STATUS = "Loading sessions...";

const readPins = (key: string): string[] => {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const writePins = (key: string, pins: string[]) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(pins));
  } catch {
    // Pins are a per-browser convenience; losing them is harmless.
  }
};

const DAY = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const groupOf = (iso: string, now: Date) => {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "Older";
  const today = startOfDay(now);
  if (time >= today) return "Today";
  if (time >= today - DAY) return "Yesterday";
  if (time >= today - 6 * DAY) return "Earlier this week";
  return "Older";
};

const GROUP_ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

const relativeTime = (iso: string, now: Date) => {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const minutes = Math.round((now.getTime() - time) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString([], { month: "short", day: "numeric" });
};

const lastActive = (session: Session) => session.updatedAt || session.createdAt;
const activeTime = (session: Session) => {
  const time = new Date(lastActive(session)).getTime();
  return Number.isNaN(time) ? 0 : time;
};

// Simple one-tone 10x10 pixel icons; state is shown by colour, not by extra detail.
const ICONS = {
  pin: "M2 1h6v1h-6zM3 2h4v1h-4zM3 3h4v1h-4zM1 4h8v1h-8zM4 5h2v1h-2zM4 6h2v1h-2zM4 7h2v1h-2zM4 8h1v1h-1z",
  pencil: "M7 1h2v1h-2zM6 2h3v1h-3zM5 3h3v1h-3zM4 4h3v1h-3zM3 5h3v1h-3zM2 6h3v1h-3zM2 7h2v1h-2zM1 8h1v1h-1z"
} as const;

function PixelIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 10 10" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
      <path d={ICONS[name]} fill="currentColor" />
    </svg>
  );
}

export default function Sidebar(props: SidebarProps) {
  const {
    sessions,
    sessionsStatus,
    currentId,
    busy,
    isOpen,
    collapsed,
    requiresAuth,
    identity,
    onClose,
    onToggleCollapsed,
    onHome,
    onNewCouncil,
    onOpen,
    onRefresh,
    onRename,
    onSignOut
  } = props;

  const [query, setQuery] = useState("");
  const pinKey = pinKeyFor(identity);
  const [pins, setPins] = useState<string[]>(() => readPins(pinKey));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [notice, setNotice] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const newRef = useRef<HTMLButtonElement | null>(null);
  const committingRef = useRef(false);
  const now = new Date();

  useEffect(() => {
    setPins(readPins(pinKey));
  }, [pinKey]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Drawer (small screens): move focus in when it opens, and back to where it was when it closes.
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    newRef.current?.focus();
    return () => previous?.focus?.();
  }, [isOpen]);

  const isLoading = sessionsStatus === LOADING_STATUS;
  const error = !isLoading && sessionsStatus ? sessionsStatus : "";

  const blockedWhileBusy = () => {
    if (!busy) return false;
    setNotice("The council is still answering. Switch once this round finishes.");
    return true;
  };

  const openCouncil = (session: Session) => {
    if (session.id === currentId) {
      onClose();
      return;
    }
    if (blockedWhileBusy()) return;
    onOpen(session);
  };

  const startNew = () => {
    if (blockedWhileBusy()) return;
    onNewCouncil();
  };
  const showSearch = sessions.length >= 4;

  // "/" jumps to search, like most tools people already know.
  useEffect(() => {
    if (!showSearch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const input = searchRef.current;
      if (!input || input.getClientRects().length === 0 || getComputedStyle(input).visibility === "hidden") return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showSearch]);

  const togglePin = (id: string) => {
    setPins((prev) => {
      const next = prev.includes(id) ? prev.filter((item) => item !== id) : [id, ...prev];
      writePins(pinKey, next);
      return next;
    });
  };

  const startRename = (session: Session) => {
    committingRef.current = false;
    setEditingId(session.id);
    setDraftTitle(session.title ?? "");
  };

  const commitRename = () => {
    // Enter commits and unmounts the input, which can also fire blur: commit once.
    if (!editingId || committingRef.current) return;
    committingRef.current = true;
    const title = draftTitle.trim();
    const original = sessions.find((item) => item.id === editingId)?.title ?? "";
    if (title && title !== original) onRename(editingId, title.slice(0, 80));
    setEditingId(null);
  };

  const onRenameKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setEditingId(null);
    }
  };

  const groups = (() => {
    const needle = query.trim().toLowerCase();
    const matches = sessions
      .filter((item) => {
        if (!needle) return true;
        return `${item.title ?? ""} ${item.mode ?? ""}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => activeTime(b) - activeTime(a));

    const result: Array<{ label: string; items: Session[] }> = [];
    const pinned = matches.filter((item) => pins.includes(item.id));
    if (pinned.length) result.push({ label: "Pinned", items: pinned });
    for (const label of GROUP_ORDER) {
      const items = matches.filter((item) => !pins.includes(item.id) && groupOf(lastActive(item), now) === label);
      if (items.length) result.push({ label, items });
    }
    return result;
  })();

  const current = sessions.find((item) => item.id === currentId) ?? null;
  const resultCount = groups.reduce((total, group) => total + group.items.length, 0);

  const renderRow = (session: Session) => {
    const stop = pressureFor(session.mode ?? "Brainstorm");
    const isCurrent = session.id === currentId;
    const isPinned = pins.includes(session.id);
    const title = session.title ?? "Untitled council";

    if (editingId === session.id) {
      return (
        <li key={session.id} className="sb-row" data-current={isCurrent} data-editing="true">
          <label className="sr-only" htmlFor={`rename-${session.id}`}>
            Rename council
          </label>
          <input
            id={`rename-${session.id}`}
            className="sb-rename"
            value={draftTitle}
            maxLength={80}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={onRenameKey}
            onBlur={commitRename}
          />
        </li>
      );
    }

    return (
      <li key={session.id} className="sb-row" data-current={isCurrent}>
        <button
          type="button"
          className="sb-open"
          aria-current={isCurrent ? "page" : undefined}
          onClick={() => openCouncil(session)}
          title={`${title}, ${stop.mode}`}
        >
          <HeatBars level={stop.level} className="sb-heat" />
          <span className="sb-title">{title}</span>
          <time className="sb-time" dateTime={lastActive(session)}>
            {relativeTime(lastActive(session), now)}
          </time>
        </button>
        <span className="sb-actions">
          <button
            type="button"
            className="sb-action"
            aria-pressed={isPinned}
            aria-label={isPinned ? `Unpin ${title}` : `Pin ${title}`}
            title={isPinned ? "Unpin" : "Pin to top"}
            onClick={() => togglePin(session.id)}
          >
            <PixelIcon name="pin" />
          </button>
          <button
            type="button"
            className="sb-action"
            aria-label={`Rename ${title}`}
            title="Rename"
            onClick={() => startRename(session)}
          >
            <PixelIcon name="pencil" />
          </button>
        </span>
      </li>
    );
  };

  const renderBody = () => {
    if (isLoading && sessions.length === 0) {
      return (
        <ul className="sb-skeleton" aria-label="Loading your councils">
          {[72, 56, 64, 48].map((width) => (
            <li key={width}>
              <span style={{ width: `${width}%` }} />
            </li>
          ))}
        </ul>
      );
    }

    if (error && sessions.length === 0) {
      return (
        <div className="sb-state" role="alert">
          <p>{error}</p>
          <button type="button" className="sb-state-button" onClick={onRefresh}>
            Try again
          </button>
        </div>
      );
    }

    if (sessions.length === 0) {
      return (
        <div className="sb-state sb-empty">
          <span className="sb-empty-faces" aria-hidden="true">
            {FALLBACK_PERSONAS.map((persona) => (
              <span key={persona.name}>
                <PersonaSprite name={persona.name} />
              </span>
            ))}
          </span>
          <p>
            <strong>No councils yet.</strong> Ask your first question and it will be kept here.
          </p>
        </div>
      );
    }

    if (resultCount === 0) {
      return (
        <div className="sb-state">
          <p>No councils match "{query.trim()}".</p>
          <button type="button" className="sb-state-button" onClick={() => setQuery("")}>
            Clear search
          </button>
        </div>
      );
    }

    const list = groups.map((group) => (
      <section key={group.label} className="sb-group" aria-label={group.label}>
        <h2>{group.label}</h2>
        <ul>{group.items.map(renderRow)}</ul>
      </section>
    ));
    return (
      <>
        {error && (
          <div className="sb-banner" role="alert">
            <span>{error}</span>
            <button type="button" className="sb-banner-button" onClick={onRefresh}>
              Retry
            </button>
          </div>
        )}
        {list}
      </>
    );
  };

  return (
    <>
      <aside
        ref={asideRef}
        className="sidebar sb"
        data-open={isOpen}
        data-collapsed={collapsed}
        aria-label="Councils"
      >
        <div className="sb-top">
          <button type="button" className="sb-brand" onClick={onHome} aria-label="Think Tank home">
            <LogoMark size={30} title="" />
            <span>Think Tank</span>
          </button>
          <button
            type="button"
            className="sb-icon sb-collapse"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 8 8" width="14" height="14" shapeRendering="crispEdges" aria-hidden="true">
              <path d={collapsed ? "M2 1h1v1h1v1h1v2H4v1H3v1H2V6h1V5h1V3H3V2H2z" : "M5 1h1v1H5v1H4v2h1v1h1v1H5V6H4V5H3V3h1V2h1z"} fill="currentColor" />
            </svg>
          </button>
          <button type="button" className="sb-icon sb-close" onClick={onClose} aria-label="Close menu">
            ✕
          </button>
        </div>

        <button
          ref={newRef}
          type="button"
          className="sb-new"
          onClick={startNew}
          aria-disabled={busy}
          title={busy ? "Available once the council finishes answering" : "Start a new council"}
        >
          <span className="sb-new-plus" aria-hidden="true">
            +
          </span>
          <span className="sb-new-label">New council</span>
        </button>

        {collapsed && current && (
          <div className="sb-rail-current" title={`Current: ${current.title ?? "Untitled council"}`}>
            <HeatBars level={pressureFor(current.mode ?? "Brainstorm").level} />
          </div>
        )}

        <div className="sb-scroll">
          {showSearch && (
            <div className="sb-search">
              <svg viewBox="0 0 8 8" width="13" height="13" shapeRendering="crispEdges" aria-hidden="true">
                <path d="M1 0h3v1h1v3H4v1H1V4H0V1h1zM1 1v3h3V1zM4 5h1v1h1v1h1v1H6V7H5V6H4z" fill="currentColor" />
              </svg>
              <label className="sr-only" htmlFor="sb-search-input">
                Find a council
              </label>
              <input
                id="sb-search-input"
                ref={searchRef}
                type="search"
                placeholder="Find a council"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.stopPropagation();
                    setQuery("");
                  }
                }}
              />
              {!query && <kbd aria-hidden="true">/</kbd>}
            </div>
          )}
          {notice && (
            <p className="sb-notice" role="status">
              {notice}
            </p>
          )}
          <nav className="sb-list" aria-label="Past councils">
            {renderBody()}
          </nav>
        </div>

        <div className="sb-foot">
          {requiresAuth ? (
            <>
              <span className="sb-avatar" aria-hidden="true">
                {identity.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="sb-identity" title={identity}>
                {identity}
              </span>
              <button type="button" className="sb-signout" onClick={onSignOut}>
                Sign out
              </button>
            </>
          ) : (
            <p className="sb-local">Working locally. Councils here aren't saved to an account.</p>
          )}
        </div>
      </aside>
      {isOpen && <button type="button" className="scrim scrim-left" aria-label="Close menu" onClick={onClose} />}
    </>
  );
}
