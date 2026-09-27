import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ComponentType, ReactNode } from "react";
import type { Persona } from "./lib/types";
import { PERSONA_META, personaStyle } from "./lib/council";

/*
  The council chamber.
  - A top-down round table: five seats, the one holding the floor talks, the rest
    wear their real place in the speaking order (a number), a tick once they've
    spoken this round, or sit benched and greyed.
  - A share-of-voice bar built from the words each mind has actually said. Hover, focus or
    tap a segment for that mind's turns, words and share.
  - A compact character sheet for the seat you pick: who they are, their state, the last
    thing they said, and the two things you can do with them (ask next, seat or bench).
  Everything here is derived from the feed and the room state. No invented numbers.
*/

type FeedItem = { id: string; speaker: string; content: string; time: string };

type AvatarProps = { name: string; compact?: boolean; talking?: boolean };

export type CouncilPanelProps = {
  Avatar: ComponentType<AvatarProps>;
  personas: Persona[];
  selectedPersonas: string[];
  togglePersona: (name: string) => void;
  activePersona: string;
  askEveryone: boolean;
  /** Seated minds who will answer the next message, in seat order. */
  askTargets: string[];
  pickSpeaker: (name: string) => void;
  speakingNow: string | null;
  roundQueue: string[];
  isSending: boolean;
  feed: FeedItem[];
  mode: string;
  /** The mode control. Owned outside this panel (shared pressure component). */
  modeControl: ReactNode;
  stateOf: (name: string) => string;
  rosterOffline: boolean;
  isOpen: boolean;
  onClose: () => void;
};

// Seat positions around the table, as % of the stage (x, y of the seat's centre).
const SEATS: Array<[number, number]> = [
  [50, 15],
  [87, 44],
  [71, 86],
  [29, 86],
  [13, 44]
];

const countWords = (text: string) => {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
};

const lastLineOf = (text: string) => {
  const clean = text
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [clean];
  const usable = sentences.map((s) => s.trim()).filter((s) => s.length > 12);
  const line = usable[usable.length - 1] ?? clean;
  return line.length > 170 ? `${line.slice(0, 167).trimEnd()}...` : line;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function CouncilPanel(props: CouncilPanelProps) {
  const {
    Avatar,
    personas,
    selectedPersonas,
    togglePersona,
    askEveryone,
    askTargets,
    pickSpeaker,
    speakingNow,
    roundQueue,
    isSending,
    feed,
    modeControl,
    stateOf,
    rosterOffline,
    isOpen,
    onClose
  } = props;

  const [inspected, setInspected] = useState<string | null>(null);
  // Share of voice: the segment being pointed at, and the one pinned open by a click or tap.
  const [hoveredVoice, setHoveredVoice] = useState<string | null>(null);
  const [pinnedVoice, setPinnedVoice] = useState<string | null>(null);
  const voiceRef = useRef<HTMLElement | null>(null);
  // The sheet's quote is held to two lines; a tap opens the rest.
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteClipped, setQuoteClipped] = useState(false);
  const quoteRef = useRef<HTMLQuoteElement | null>(null);
  // Set when someone tries to bench the last mind in the room, so it never fails silently.
  const [refused, setRefused] = useState<string | null>(null);

  // A new round hands the spotlight back to whoever has the floor.
  useEffect(() => {
    if (isSending) setInspected(null);
  }, [isSending]);

  const stats = useMemo(() => {
    const perPersona = new Map<string, { turns: number; words: number; last: string }>();
    let lastUserIndex = -1;
    let rounds = 0;
    feed.forEach((item, index) => {
      if (item.speaker === "User") {
        lastUserIndex = index;
        rounds += 1;
        return;
      }
      const words = countWords(item.content);
      if (words === 0) return;
      const entry = perPersona.get(item.speaker) ?? { turns: 0, words: 0, last: "" };
      entry.turns += 1;
      entry.words += words;
      entry.last = item.content;
      perPersona.set(item.speaker, entry);
    });
    const spokeThisRound = feed
      .slice(lastUserIndex + 1)
      .filter((item) => item.speaker !== "User")
      .map((item) => item.speaker);
    let totalWords = 0;
    perPersona.forEach((entry) => {
      totalWords += entry.words;
    });
    let lastSpeaker: string | null = null;
    for (let i = feed.length - 1; i >= 0; i -= 1) {
      if (feed[i].speaker !== "User") {
        lastSpeaker = feed[i].speaker;
        break;
      }
    }
    return { perPersona, spokeThisRound, totalWords, rounds, lastSpeaker };
  }, [feed]);

  // The speaking order for what happens next: live during a round, planned when idle.
  const order = useMemo(() => {
    if (isSending) return roundQueue;
    return askTargets;
  }, [isSending, roundQueue, askTargets]);

  const focus =
    (inspected && personas.some((p) => p.name === inspected) ? inspected : null) ??
    speakingNow ??
    (askTargets.length === 1 ? askTargets[0] : null) ??
    stats.lastSpeaker ??
    personas[0]?.name ??
    "Devil";

  const roundSize = isSending
    ? stats.spokeThisRound.length + roundQueue.length
    : 0;
  const roundPosition = isSending ? Math.max(stats.spokeThisRound.length, 1) : 0;

  const seatedCount = selectedPersonas.length;

  useEffect(() => {
    if (!refused) return;
    const timer = window.setTimeout(() => setRefused(null), 4000);
    return () => window.clearTimeout(timer);
  }, [refused]);

  // Clear the warning as soon as the room has more than one mind again.
  useEffect(() => {
    if (seatedCount > 1) setRefused(null);
  }, [seatedCount]);

  const flip = (name: string) => {
    const seated = selectedPersonas.includes(name);
    if (seated && seatedCount <= 1) {
      setRefused(name);
      return;
    }
    togglePersona(name);
  };

  const renderTable = () => {
    const speakerColor = speakingNow ? personaStyle(speakingNow) : undefined;
    return (
      <div className="chamber" data-live={Boolean(speakingNow)} style={speakerColor}>
        <div className="chamber-table" aria-hidden="true">
          <div className="chamber-top">
            {speakingNow ? (
              <>
                <strong className="chamber-name">{speakingNow}</strong>
                <span>has the floor</span>
                {roundSize > 1 && (
                  <span className="chamber-count">
                    {roundPosition} of {roundSize}
                  </span>
                )}
              </>
            ) : isSending ? (
              <>
                <strong className="chamber-name">Gathering</strong>
                <span>the room is thinking</span>
              </>
            ) : (
              <>
                <strong className="chamber-name">Your move</strong>
                <span>
                  {stats.rounds === 0 ? "No rounds yet" : `${plural(stats.rounds, "round")} so far`}
                </span>
              </>
            )}
          </div>
        </div>
        <p className="sr-only">
          {speakingNow
            ? `${speakingNow} has the floor.`
            : isSending
              ? "The room is thinking."
              : "Your move."}
        </p>
        <ul className="chamber-seats" aria-label="Seats at the table">
          {personas.slice(0, SEATS.length).map((persona, index) => {
            const name = persona.name;
            const seated = selectedPersonas.includes(name);
            const speaking = speakingNow === name;
            const queuePos = order.indexOf(name);
            const spoke = isSending && !speaking && stats.spokeThisRound.includes(name);
            const [x, y] = SEATS[index];
            const state = stateOf(name);
            let badge: string | null = null;
            let badgeLabel = "";
            if (seated && !speaking) {
              if (spoke) {
                badge = "✓";
                badgeLabel = "spoke this round";
              } else if (queuePos >= 0) {
                badge = String(queuePos + 1);
                badgeLabel = `${queuePos === 0 ? "first" : `number ${queuePos + 1}`} in line`;
              }
            }
            return (
              <li
                key={name}
                className="seat"
                style={{ ...personaStyle(name), left: `${x}%`, top: `${y}%` }}
                data-seated={seated}
                data-speaking={speaking}
                data-focus={focus === name}
              >
                <button
                  type="button"
                  className="seat-button"
                  aria-pressed={focus === name}
                  aria-label={`${name}, ${state.toLowerCase()}${badgeLabel ? `, ${badgeLabel}` : ""}. Show details`}
                  onClick={() => setInspected(name)}
                >
                  <span className="seat-cursor" aria-hidden="true" />
                  <span className="seat-chair">
                    <Avatar name={name} compact talking={speaking} />
                    {speaking && (
                      <span className="seat-bubble" aria-hidden="true">
                        <i />
                      </span>
                    )}
                    {badge && (
                      <span className="seat-badge" data-kind={spoke ? "done" : "queue"} aria-hidden="true">
                        {badge}
                      </span>
                    )}
                  </span>
                  <span className="seat-name" aria-hidden="true">
                    {seated ? name : "Benched"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  const voiceShown = hoveredVoice ?? pinnedVoice;

  // A pinned card closes on a click anywhere else or on Escape.
  useEffect(() => {
    if (!pinnedVoice) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setPinnedVoice(null);
        return;
      }
      if (!voiceRef.current?.contains(event.target as Node)) setPinnedVoice(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [pinnedVoice]);

  const renderVoice = () => {
    const speakers = personas.filter((p) => (stats.perPersona.get(p.name)?.words ?? 0) > 0);
    const shareOf = (name: string) => {
      const words = stats.perPersona.get(name)?.words ?? 0;
      return stats.totalWords ? Math.round((words / stats.totalWords) * 100) : 0;
    };
    // Where each segment's middle sits along the bar, so the card can point at it.
    let running = 0;
    const centres = new Map<string, number>();
    speakers.forEach((p) => {
      const words = stats.perPersona.get(p.name)?.words ?? 0;
      centres.set(p.name, ((running + words / 2) / (stats.totalWords || 1)) * 100);
      running += words;
    });
    const shown = voiceShown && centres.has(voiceShown) ? voiceShown : null;
    const shownStats = shown ? stats.perPersona.get(shown) : undefined;
    return (
      <section className="voice" aria-labelledby="voice-title" ref={voiceRef}>
        <div className="voice-head">
          <h3 id="voice-title">Share of voice</h3>
          <span>{plural(stats.totalWords, "word")}</span>
        </div>
        {stats.totalWords === 0 ? (
          <div className="voice-bar voice-bar-empty">
            <span className="sr-only">Nobody has spoken yet.</span>
          </div>
        ) : (
          <div className="voice-bar" role="group" aria-label="Share of voice. Pick a mind for their turns, words and share.">
            {speakers.map((p) => {
              const own = stats.perPersona.get(p.name);
              const share = shareOf(p.name);
              return (
                <button
                  key={p.name}
                  type="button"
                  className="voice-seg"
                  data-live={speakingNow === p.name}
                  data-shown={shown === p.name}
                  aria-expanded={pinnedVoice === p.name}
                  aria-label={`${p.name}: ${plural(own?.turns ?? 0, "turn")}, ${plural(own?.words ?? 0, "word")}, ${share}% of the voice`}
                  style={{ ...personaStyle(p.name), flexGrow: own?.words ?? 0 }}
                  onMouseEnter={() => setHoveredVoice(p.name)}
                  onMouseLeave={() => setHoveredVoice(null)}
                  onFocus={() => setHoveredVoice(p.name)}
                  onBlur={() => setHoveredVoice(null)}
                  onClick={() => {
                    // Tapping pins the card and opens that mind's sheet below.
                    setPinnedVoice((current) => (current === p.name ? null : p.name));
                    setInspected(p.name);
                  }}
                />
              );
            })}
          </div>
        )}
        {shown && (
          <div
            className="voice-card"
            style={{ ...personaStyle(shown), "--at": `${centres.get(shown)}%` } as CSSProperties}
            aria-hidden="true"
          >
            <strong>{shown}</strong>
            <dl>
              <div>
                <dt>Turns</dt>
                <dd>{shownStats?.turns ?? 0}</dd>
              </div>
              <div>
                <dt>Words</dt>
                <dd>{shownStats?.words ?? 0}</dd>
              </div>
              <div>
                <dt>Voice</dt>
                <dd>{shareOf(shown)}%</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    );
  };

  // A new mind in the sheet starts with its quote folded again.
  useEffect(() => {
    setQuoteOpen(false);
  }, [focus]);

  // Only offer "more" when the two-line fold actually hides something.
  useLayoutEffect(() => {
    const element = quoteRef.current;
    if (!element || quoteOpen) return;
    const clipped = element.scrollHeight > element.clientHeight + 1;
    setQuoteClipped((current) => (current === clipped ? current : clipped));
  });

  const renderSheet = () => {
    const persona = personas.find((p) => p.name === focus);
    if (!persona) return null;
    const name = persona.name;
    const meta = PERSONA_META[name];
    const own = stats.perPersona.get(name);
    const seated = selectedPersonas.includes(name);
    const speaking = speakingNow === name;
    const isNext = !askEveryone && askTargets.includes(name);
    const lastLine = own ? lastLineOf(own.last) : "";
    const lonely = seated && seatedCount <= 1;
    const tail = feed[feed.length - 1];
    const liveLine = speaking && tail?.speaker === name && countWords(tail.content) > 0;
    const caption = lastLine ? (liveLine ? "Saying now" : "Last said") : "Hasn't spoken yet. Listens for";
    const quote = lastLine || (meta?.signal ?? persona.tagline);
    return (
      <section
        className="sheet"
        style={personaStyle(name)}
        data-seated={seated}
        aria-labelledby="sheet-name"
        key={name}
      >
        {/* The state rides on the card's top edge, like a nameplate, so it costs no height. */}
        <span className="sheet-state" data-speaking={speaking}>
          {stateOf(name)}
        </span>
        <header className="sheet-head">
          <h3 id="sheet-name">{name}</h3>
          <p>{meta?.archetype ?? persona.role}</p>
        </header>

        <button
          type="button"
          className="sheet-line"
          data-empty={!lastLine}
          data-open={quoteOpen}
          aria-expanded={quoteClipped || quoteOpen ? quoteOpen : undefined}
          disabled={!quoteClipped && !quoteOpen}
          onClick={() => setQuoteOpen((open) => !open)}
          title={quoteClipped && !quoteOpen ? "Show the whole line" : undefined}
        >
          <blockquote ref={quoteRef}>
            <em>{caption}</em> {quote}
          </blockquote>
          {quoteClipped && !quoteOpen && (
            <span className="sheet-more" aria-hidden="true">
              more
            </span>
          )}
        </button>

        <div className="sheet-actions">
          <button
            type="button"
            className="sheet-ask"
            onClick={() => pickSpeaker(name)}
            disabled={!seated}
            aria-pressed={isNext}
          >
            {isNext ? `${name} answers next` : `Ask ${name} next`}
          </button>
          <button
            type="button"
            className="sheet-seat"
            onClick={() => flip(name)}
            aria-disabled={lonely || undefined}
            aria-describedby={lonely ? "sheet-seat-note" : undefined}
            data-locked={lonely}
            title={lonely ? `${name} is the last one in, so they can't be benched yet.` : undefined}
          >
            {seated ? "Bench" : "Seat"}
          </button>
        </div>
        <p id="sheet-seat-note" className={refused ? "sheet-note" : "sr-only"} role="status" aria-live="polite">
          {refused ? (
            `Someone has to stay in the room. Seat another mind before benching ${refused}.`
          ) : lonely ? (
            <span className="sr-only">{name} is the last one in, so they can't be benched yet.</span>
          ) : (
            ""
          )}
        </p>
      </section>
    );
  };

  return (
    <>
      <aside className="council" data-open={isOpen} aria-label="Council">
        <div className="council-head">
          <h2>In the room</h2>
          <span className="council-tally">
            {seatedCount} of {personas.length} seated
          </span>
          <button
            type="button"
            className="icon-button council-close"
            onClick={onClose}
            aria-label="Close council panel"
          >
            ✕
          </button>
        </div>

        {renderTable()}
        {renderVoice()}
        {renderSheet()}

        {rosterOffline && (
          <p className="council-note">The roster service is offline, so built-in profiles are shown.</p>
        )}

        <section className="council-mode" aria-labelledby="council-mode-title">
          <h3 id="council-mode-title">Pressure</h3>
          {modeControl}
        </section>

      </aside>
      {isOpen && (
        <button
          type="button"
          className="scrim scrim-right"
          aria-label="Close council panel"
          onClick={onClose}
        />
      )}
    </>
  );
}
