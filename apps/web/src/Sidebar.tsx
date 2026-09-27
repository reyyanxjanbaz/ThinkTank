import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Session } from "./lib/types";
import { FALLBACK_PERSONAS, PERSONA_COLORS } from "./lib/council";
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
  /** The open council's counts, taken from its live transcript so the slot updates as replies land. */
  liveSummary: { id: string; turnCount: number; speakers: string[] } | null;
  /** Takes the minutes of a council (any saved one, not only the open one). */
  onExport: (session: Session, format: "md" | "pdf") => void;
  isExporting: boolean;
  exportStatus: string;
  /** Deletes a council for good; resolves to an error message, or null once it's gone. */
  onDelete: (session: Session) => Promise<string | null>;
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
  pencil: "M7 1h2v1h-2zM6 2h3v1h-3zM5 3h3v1h-3zM4 4h3v1h-3zM3 5h3v1h-3zM2 6h3v1h-3zM2 7h2v1h-2zM1 8h1v1h-1z",
  more: "M1 4h2v2h-2zM4 4h2v2h-2zM7 4h2v2h-2z",
  trash: "M3 0h4v1h-4zM0 1h10v1h-10zM1 2h1v8h-1zM8 2h1v8h-1zM2 9h6v1h-6zM3 3h1v5h-1zM6 3h1v5h-1z",
  scroll: "M2 1h6v1h-6zM1 2h1v1h-1zM8 2h1v6h-1zM2 2h1v7h-1zM3 8h6v1h-6zM4 3h3v1h-3zM4 5h3v1h-3zM4 7h2v1h-2z"
} as const;

/** Where a row menu opens: under its trigger, or anchored by its bottom edge when there's no room below. */
type MenuState = { id: string; left: number; top?: number; bottom?: number } | null;
const MENU_W = 220;

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
    liveSummary,
    onExport,
    isExporting,
    exportStatus,
    onDelete,
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
  // One row menu at a time, drawn in a fixed layer so the scrolling list can't clip it.
  const [menu, setMenu] = useState<MenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  // Delete asks once, inside the menu, before anything is removed.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const openMenu = (session: Session, trigger: HTMLButtonElement) => {
    if (menu?.id === session.id) {
      setMenu(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    // Room for the menu below the trigger? Otherwise open upwards.
    const up = window.innerHeight - rect.bottom < 250;
    const left = Math.max(8, Math.min(rect.right - MENU_W, window.innerWidth - MENU_W - 8));
    menuTriggerRef.current = trigger;
    setMenu(
      up
        ? { id: session.id, left, bottom: window.innerHeight - rect.top + 6 }
        : { id: session.id, left, top: rect.bottom + 6 }
    );
  };

  const closeMenu = (restoreFocus = false) => {
    // Focus the trigger while its row is still showing it; focus-within then keeps it visible.
    if (restoreFocus) menuTriggerRef.current?.focus();
    setMenu(null);
  };

  useEffect(() => {
    setConfirmingDelete(false);
  }, [menu?.id]);

  // The confirmation opens on the safe choice; backing out returns to Delete.
  const confirmSeen = useRef(false);
  useEffect(() => {
    if (!menu) return;
    if (confirmingDelete) confirmSeen.current = true;
    else if (!confirmSeen.current) return;
    window.requestAnimationFrame(() =>
      menuRef.current
        ?.querySelector<HTMLButtonElement>(confirmingDelete ? ".sb-confirm-cancel" : ".sb-menu-danger")
        ?.focus()
    );
    if (!confirmingDelete) confirmSeen.current = false;
  }, [confirmingDelete]);

  useEffect(() => {
    if (!menu) return;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus());
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || menuTriggerRef.current?.contains(target)) return;
      setMenu(null);
    };
    const onMove = () => setMenu(null);
    // Escape closes the menu wherever focus is, even in the moment before it lands on the first item.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      menuTriggerRef.current?.focus();
      setMenu(null);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onMove);
    const scroller = asideRef.current?.querySelector(".sb-scroll");
    scroller?.addEventListener("scroll", onMove);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onMove);
      scroller?.removeEventListener("scroll", onMove);
    };
  }, [menu?.id]);

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      // Escape here closes only the menu, not the drawer behind it.
      event.nativeEvent.stopPropagation();
      closeMenu(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  };

  const confirmDelete = async (session: Session) => {
    setDeleting(true);
    const error = await onDelete(session);
    setDeleting(false);
    if (error) {
      setNotice(error);
      closeMenu(true);
      return;
    }
    setPins((prev) => {
      if (!prev.includes(session.id)) return prev;
      const next = prev.filter((item) => item !== session.id);
      writePins(pinKey, next);
      return next;
    });
    setMenu(null);
    setNotice(`Deleted “${session.title ?? "Untitled council"}”.`);
    window.requestAnimationFrame(() => newRef.current?.focus());
  };

  const renderMenu = () => {
    if (!menu) return null;
    const session = sessions.find((item) => item.id === menu.id);
    if (!session) return null;
    const title = session.title ?? "Untitled council";
    const isPinned = pins.includes(session.id);
    const isDraft = session.id.startsWith("local-");
    const exportTitle = isDraft ? "Local drafts have no saved minutes yet" : undefined;
    const act = (fn: () => void) => () => {
      closeMenu(true);
      fn();
    };
    if (confirmingDelete) {
      return (
        <div
          ref={menuRef}
          className="sb-menu sb-menu-confirm"
          role="alertdialog"
          aria-labelledby="sb-delete-title"
          aria-describedby="sb-delete-copy"
          style={{ top: menu.top, bottom: menu.bottom, left: menu.left, width: MENU_W }}
          onKeyDown={onMenuKey}
        >
          <p className="sb-confirm-title" id="sb-delete-title">
            Delete “{title}”?
          </p>
          <p className="sb-confirm-copy" id="sb-delete-copy">
            The transcript, its uploads and its minutes are removed for good. This can't be undone.
          </p>
          <div className="sb-confirm-actions">
            <button
              type="button"
              role="menuitem"
              className="sb-confirm-cancel"
              disabled={deleting}
              onClick={() => setConfirmingDelete(false)}
            >
              Keep it
            </button>
            <button
              type="button"
              role="menuitem"
              className="sb-confirm-delete"
              disabled={deleting}
              onClick={() => void confirmDelete(session)}
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        ref={menuRef}
        className="sb-menu"
        role="menu"
        aria-label={`Actions for ${title}`}
        style={{ top: menu.top, bottom: menu.bottom, left: menu.left, width: MENU_W }}
        onKeyDown={onMenuKey}
      >
        <button
          type="button"
          role="menuitem"
          className="sb-menu-item"
          onClick={act(() => {
            togglePin(session.id);
            // The row moves between groups and remounts; put focus back on its menu button.
            window.requestAnimationFrame(() =>
              asideRef.current?.querySelector<HTMLButtonElement>(`.sb-row[data-id="${session.id}"] .sb-more`)?.focus()
            );
          })}
        >
          <PixelIcon name="pin" />
          {isPinned ? "Unpin" : "Pin to top"}
        </button>
        <button
          type="button"
          role="menuitem"
          className="sb-menu-item"
          onClick={() => {
            // Focus goes to the rename field, not back to the trigger.
            setMenu(null);
            startRename(session);
          }}
        >
          <PixelIcon name="pencil" />
          Rename
        </button>
        <div className="sb-menu-group" role="group" aria-label="Take the minutes">
          <p className="sb-menu-label" aria-hidden="true">
            <PixelIcon name="scroll" />
            Take the minutes
          </p>
          <div className="sb-menu-formats">
            <button
              type="button"
              role="menuitem"
              className="sb-menu-format"
              disabled={isDraft || isExporting}
              title={exportTitle}
              aria-label={`Take the minutes as Markdown`}
              onClick={act(() => onExport(session, "md"))}
            >
              Markdown
            </button>
            <button
              type="button"
              role="menuitem"
              className="sb-menu-format"
              disabled={isDraft || isExporting}
              title={exportTitle}
              aria-label={`Take the minutes as PDF`}
              onClick={act(() => onExport(session, "pdf"))}
            >
              PDF
            </button>
          </div>
        </div>
        <button
          type="button"
          role="menuitem"
          className="sb-menu-item sb-menu-danger"
          disabled={busy && session.id === currentId}
          title={busy && session.id === currentId ? "Available once the council finishes answering" : undefined}
          onClick={() => setConfirmingDelete(true)}
        >
          <PixelIcon name="trash" />
          Delete
        </button>
      </div>
    );
  };

  const renderRow = (session: Session) => {
    const stop = pressureFor(session.mode ?? "Brainstorm");
    const isCurrent = session.id === currentId;
    const isPinned = pins.includes(session.id);
    const title = session.title ?? "Untitled council";
    const live = liveSummary && liveSummary.id === session.id ? liveSummary : null;
    const turnCount = live?.turnCount ?? session.turnCount;
    const speakers = live?.speakers ?? session.speakers ?? [];
    const turnsLabel =
      turnCount === undefined ? "" : turnCount === 0 ? "No turns yet" : turnCount === 1 ? "1 turn" : `${turnCount} turns`;

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
      <li key={session.id} className="sb-row" data-current={isCurrent} data-id={session.id}>
        {/* A save slot: title, then pressure and turns, then a mark for each mind that spoke. */}
        <button
          type="button"
          className="sb-open sb-slot"
          aria-current={isCurrent ? "page" : undefined}
          onClick={() => openCouncil(session)}
          title={`${title}, ${stop.mode}`}
        >
          <span className="sb-slot-top">
            <span className="sb-title">{title}</span>
            <time className="sb-time" dateTime={lastActive(session)}>
              {relativeTime(lastActive(session), now)}
            </time>
          </span>
          <span className="sb-meta">
            <HeatBars level={stop.level} className="sb-heat" />
            <span>{stop.name}</span>
            {turnsLabel && (
              <>
                {" "}
                <span aria-hidden="true">·</span> <span>{turnsLabel}</span>
              </>
            )}
            {/* One small mark per mind that spoke, on the same line so the slot stays two lines tall. */}
            {speakers.length > 0 && (
              <span className="sb-dots" title={`Spoke: ${speakers.join(", ")}`}>
                {speakers.map((name) => (
                  <i key={name} style={{ background: PERSONA_COLORS[name] ?? "var(--frame)" }} />
                ))}
                <span className="sr-only">. Spoke: {speakers.join(", ")}</span>
              </span>
            )}
          </span>
        </button>
        <span className="sb-actions" data-open={menu?.id === session.id}>
          <button
            type="button"
            className="sb-action sb-more"
            aria-haspopup="menu"
            aria-expanded={menu?.id === session.id}
            aria-label={`More for ${title}${isPinned ? ", pinned" : ""}`}
            title="Pin, rename, take the minutes, delete"
            onClick={(event) => openMenu(session, event.currentTarget)}
          >
            <PixelIcon name="more" />
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
          {exportStatus && (
            <p className="sb-notice" data-busy={isExporting} role="status" aria-live="polite">
              {exportStatus}
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
      {renderMenu()}
      {isOpen && <button type="button" className="scrim scrim-left" aria-label="Close menu" onClick={onClose} />}
    </>
  );
}
