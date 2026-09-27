import { useEffect, useMemo, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import type { Persona } from "./lib/types";
import { PERSONA_META, personaStyle } from "./lib/council";

/*
  The council chamber.
  - A top-down round table: five seats, the one holding the floor talks, the rest
    wear their real place in the speaking order (a number), a tick once they've
    spoken this round, or sit benched and greyed.
  - A share-of-voice bar built from the words each mind has actually said.
  - A character sheet for the seat you pick: turns, words, voice, the last thing
    they said, and the two things you can do with them (ask next, seat or bench).
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
  canExport: boolean;
  onExport: (format: "md" | "pdf") => void;
  isExporting: boolean;
  exportStatus: string;
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
    canExport,
    onExport,
    isExporting,
    exportStatus,
    rosterOffline,
    isOpen,
    onClose
  } = props;

  const [inspected, setInspected] = useState<string | null>(null);
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

  const renderRoster = () => {
    const lastOne = seatedCount === 1 ? selectedPersonas[0] : null;
    return (
      <section className="roster" aria-labelledby="roster-title">
        <div className="roster-head">
          <h3 id="roster-title">Who's in</h3>
          <span>Tap to seat or bench</span>
        </div>
        <ul className="roster-strip">
          {personas.map((persona) => {
            const name = persona.name;
            const seated = selectedPersonas.includes(name);
            const locked = seated && seatedCount <= 1;
            return (
              <li key={name} style={personaStyle(name)}>
                <button
                  type="button"
                  role="switch"
                  className="roster-switch"
                  aria-checked={seated}
                  aria-disabled={locked || undefined}
                  aria-describedby={locked ? "roster-note" : undefined}
                  aria-label={`${name} seated`}
                  data-seated={seated}
                  data-locked={locked}
                  data-refused={refused === name}
                  title={
                    locked
                      ? `${name} is the last one in. Seat someone else first.`
                      : seated
                        ? `Bench ${name}`
                        : `Seat ${name}`
                  }
                  onClick={() => flip(name)}
                >
                  <span className="roster-name">{name}</span>
                  <span className="roster-track" aria-hidden="true">
                    <span className="roster-knob" />
                    <span className="roster-word">{seated ? "In" : "Out"}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p
          id="roster-note"
          className="roster-note"
          data-alert={Boolean(refused)}
          role="status"
          aria-live="polite"
        >
          {lastOne
            ? refused
              ? `Someone has to stay in the room. Seat another mind before benching ${lastOne}.`
              : `${lastOne} is the last one in, so they can't be benched yet.`
            : ""}
        </p>
      </section>
    );
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

  const renderVoice = () => {
    const speakers = personas.filter((p) => (stats.perPersona.get(p.name)?.words ?? 0) > 0);
    const summary = speakers
      .map((p) => {
        const words = stats.perPersona.get(p.name)?.words ?? 0;
        return `${p.name} ${Math.round((words / stats.totalWords) * 100)}%`;
      })
      .join(", ");
    return (
      <section className="voice" aria-labelledby="voice-title">
        <div className="voice-head">
          <h3 id="voice-title">Share of voice</h3>
          <span>{plural(stats.totalWords, "word")}</span>
        </div>
        {stats.totalWords === 0 ? (
          <div className="voice-bar voice-bar-empty">
            <span className="sr-only">Nobody has spoken yet.</span>
          </div>
        ) : (
          <div className="voice-bar" role="img" aria-label={`Share of voice: ${summary}`}>
            {speakers.map((p) => {
              const words = stats.perPersona.get(p.name)?.words ?? 0;
              return (
                <span
                  key={p.name}
                  className="voice-seg"
                  data-live={speakingNow === p.name}
                  style={{ ...personaStyle(p.name), flexGrow: words }}
                  title={`${p.name}: ${Math.round((words / stats.totalWords) * 100)}%`}
                />
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderSheet = () => {
    const persona = personas.find((p) => p.name === focus);
    if (!persona) return null;
    const name = persona.name;
    const meta = PERSONA_META[name];
    const own = stats.perPersona.get(name);
    const seated = selectedPersonas.includes(name);
    const speaking = speakingNow === name;
    const isNext = !askEveryone && askTargets.includes(name);
    const share = own && stats.totalWords ? Math.round((own.words / stats.totalWords) * 100) : 0;
    const lastLine = own ? lastLineOf(own.last) : "";
    const lonely = seated && seatedCount <= 1;
    const tail = feed[feed.length - 1];
    const liveLine = speaking && tail?.speaker === name && countWords(tail.content) > 0;
    return (
      <section
        className="sheet"
        style={personaStyle(name)}
        data-seated={seated}
        aria-labelledby="sheet-name"
        key={name}
      >
        <header className="sheet-head">
          <h3 id="sheet-name">{name}</h3>
          <span className="sheet-state" data-speaking={speaking}>
            {stateOf(name)}
          </span>
          <p>{meta?.archetype ?? persona.role}</p>
        </header>

        <dl className="sheet-stats">
          <div>
            <dt>Turns</dt>
            <dd>{own?.turns ?? 0}</dd>
          </div>
          <div>
            <dt>Words</dt>
            <dd>{own?.words ?? 0}</dd>
          </div>
          <div>
            <dt>Voice</dt>
            <dd>{share}%</dd>
          </div>
        </dl>

        <figure className="sheet-line" data-empty={!lastLine}>
          <figcaption>
            {lastLine ? (liveLine ? "Saying now" : "Last said") : "Hasn't spoken yet. Listens for"}
          </figcaption>
          <blockquote>{lastLine || (meta?.signal ?? persona.tagline)}</blockquote>
        </figure>

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
            aria-describedby={lonely ? "roster-note" : undefined}
            data-locked={lonely}
            title={lonely ? "Someone has to stay in the room" : undefined}
          >
            {seated ? "Bench" : "Seat"}
          </button>
        </div>
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
        {renderRoster()}
        {renderVoice()}
        {renderSheet()}

        {rosterOffline && (
          <p className="council-note">The roster service is offline, so built-in profiles are shown.</p>
        )}

        <section className="council-mode" aria-labelledby="council-mode-title">
          <h3 id="council-mode-title">Pressure</h3>
          {modeControl}
        </section>

        {canExport && (
          <section className="minutes" aria-labelledby="minutes-title">
            <h3 id="minutes-title">Take the minutes</h3>
            <div className="minutes-row">
              <button type="button" className="ghost-button" onClick={() => onExport("md")} disabled={isExporting}>
                Markdown
              </button>
              <button type="button" className="ghost-button" onClick={() => onExport("pdf")} disabled={isExporting}>
                PDF
              </button>
            </div>
            {exportStatus && <p role="status">{exportStatus}</p>}
          </section>
        )}
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
