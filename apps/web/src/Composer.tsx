import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MutableRefObject } from "react";
import type { Persona } from "./lib/types";
import { PERSONA_META, personaStyle } from "./lib/council";
import { HeatBars, pressureFor } from "./Pressure";
import { PersonaSprite } from "./sprites";
import { applySuggestion, suggestionAt, suggestionsFor } from "./lib/tokens";
import { useOnline } from "./lib/pwa";
import type { ParsedPrompt, Suggestion, SuggestionQuery } from "./lib/tokens";

/*
  The dialogue box. One place decides who is in the room and who answers:
  - named chips for the seated minds (tap to ask, × to bench), benched minds wait at the end as "+ Name";
  - "@Bucks" in the message picks who answers, "/court" at the start sets the pressure;
  both shortcuts autocomplete and are highlighted inside the input as they are typed.
*/

type ComposerProps = {
  personas: Persona[];
  seated: string[];
  /** Who answers the next message: @mentions when there are any, otherwise the chips. */
  targets: string[];
  mentionsLead: boolean;
  askEveryone: boolean;
  speakingNow: string | null;
  onAskEveryone: () => void;
  onToggleAsk: (name: string) => void;
  onBench: (name: string) => void;
  onSeat: (name: string) => void;
  prompt: string;
  parsed: ParsedPrompt;
  onPromptChange: (value: string) => void;
  promptRef: MutableRefObject<HTMLTextAreaElement | null>;
  onSend: () => void;
  isSending: boolean;
  isLaunching: boolean;
  isFresh: boolean;
  canAttach: boolean;
  attachLabel: string;
  attachStatus: string;
  onAttach: (file: File) => void;
  onDismissAttach: () => void;
};

const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

function Face({ name, talking = false }: { name: string; talking?: boolean }) {
  return (
    <span className="chip-face" aria-hidden="true">
      <span className="avatar-shell avatar-shell-compact" data-talking={talking}>
        <PersonaSprite name={name} talking={talking} className="pixel-avatar" />
      </span>
    </span>
  );
}

export default function Composer(props: ComposerProps) {
  const {
    personas,
    seated,
    targets,
    mentionsLead,
    askEveryone,
    speakingNow,
    onAskEveryone,
    onToggleAsk,
    onBench,
    onSeat,
    prompt,
    parsed,
    onPromptChange,
    promptRef,
    onSend,
    isSending,
    isLaunching,
    isFresh,
    canAttach,
    attachLabel,
    attachStatus,
    onAttach,
    onDismissAttach
  } = props;

  const listId = useId();
  // Offline, nothing can reach the council; say so instead of letting a send fail.
  const online = useOnline();
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  // The trigger position the reader dismissed with Escape; the menu stays shut until they type a new one.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // Set when someone tries to bench the last mind, so the refusal is never silent.
  const [refused, setRefused] = useState<string | null>(null);

  const names = useMemo(() => personas.map((persona) => persona.name), [personas]);
  const benched = names.filter((name) => !seated.includes(name));

  const query: SuggestionQuery | null = focused ? suggestionAt(prompt, caret) : null;
  const suggestions: Suggestion[] = query ? suggestionsFor(query, names) : [];
  const menuOpen = Boolean(query) && suggestions.length > 0 && dismissedAt !== query?.start;
  const activeIndex = Math.min(active, Math.max(0, suggestions.length - 1));

  useEffect(() => {
    setActive(0);
  }, [query?.kind, query?.start, query?.query]);

  useEffect(() => {
    if (dismissedAt !== null && query?.start !== dismissedAt) setDismissedAt(null);
  }, [query?.start, dismissedAt]);

  useEffect(() => {
    if (!refused) return;
    const timer = window.setTimeout(() => setRefused(null), 4000);
    return () => window.clearTimeout(timer);
  }, [refused]);

  useEffect(() => {
    if (seated.length > 1) setRefused(null);
  }, [seated.length]);

  const syncCaret = () => setCaret(promptRef.current?.selectionStart ?? prompt.length);

  const choose = (suggestion: Suggestion) => {
    if (!query) return;
    const next = applySuggestion(prompt, caret, query, suggestion);
    onPromptChange(next.prompt);
    setCaret(next.caret);
    window.requestAnimationFrame(() => {
      const element = promptRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(next.caret, next.caret);
    });
  };

  const bench = (name: string) => {
    if (seated.length <= 1) {
      setRefused(name);
      return;
    }
    onBench(name);
  };

  // The typed token already is this suggestion ("@bucks", "/court"), so Enter should send, not complete.
  const isComplete = (suggestion: Suggestion | undefined) => {
    if (!query || !suggestion) return false;
    return suggestion.kind === "mention"
      ? suggestion.name.toLowerCase() === query.query
      : suggestion.command.word === query.query || suggestion.command.aliases.includes(query.query);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME is confirming a character; the keypress belongs to it.
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + suggestions.length) % suggestions.length);
        return;
      }
      const completeEnter = event.key === "Enter" && !event.shiftKey && isComplete(suggestions[activeIndex]);
      if (((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") && !completeEnter) {
        event.preventDefault();
        choose(suggestions[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setDismissedAt(query?.start ?? null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (online) onSend();
    }
  };

  const onlyCommand = Boolean(parsed.command) && !parsed.message;
  const benchedMentions = parsed.mentions.filter((name) => !seated.includes(name));
  const commandStop = parsed.command ? pressureFor(parsed.command.mode) : null;

  const sendLabel = !online
    ? "Offline"
    : isLaunching
      ? "Opening..."
      : isSending
        ? "Listening..."
        : onlyCommand
          ? "Set pressure"
          : targets.length === 0
            ? "Pick who answers"
            : askEveryone
              ? "Ask everyone"
              : targets.length === 1
                ? `Ask ${targets[0]}`
                : `Ask ${targets.length}`;

  const placeholder = isFresh
    ? "Describe your idea..."
    : askEveryone
      ? "Ask the whole council..."
      : targets.length === 1
        ? `Reply to ${targets[0]}...`
        : targets.length === 0
          ? "Pick who answers above..."
          : `Ask ${listNames(targets)}...`;

  const canSend = online && !isSending && !isLaunching && Boolean(prompt.trim()) && (onlyCommand || targets.length > 0);
  const lastOne = seated.length === 1 ? seated[0] : null;

  return (
    <div className="composer" style={personaStyle(targets.length === 1 ? targets[0] : "")}>
      <div className="speaker-row" role="group" aria-label="Who's in and who answers">
        <button
          type="button"
          className="speaker-chip speaker-chip-all"
          aria-pressed={askEveryone}
          onClick={onAskEveryone}
          disabled={seated.length < 2}
          title="Every seated mind answers in turn and can react to the others"
        >
          Everyone
        </button>
        {seated.map((name) => {
          const asked = targets.includes(name);
          const locked = seated.length === 1;
          return (
            <span
              key={name}
              className="seat-chip"
              style={personaStyle(name)}
              data-asked={asked}
              data-speaking={speakingNow === name}
              data-refused={refused === name}
            >
              <button
                type="button"
                className="seat-chip-ask"
                aria-pressed={asked}
                onClick={() => onToggleAsk(name)}
                title={asked ? `${name} will answer. Tap to leave them out.` : `Tap to have ${name} answer`}
              >
                <Face name={name} talking={speakingNow === name} />
                {name}
              </button>
              <button
                type="button"
                className="seat-chip-bench"
                aria-label={`Bench ${name}`}
                aria-disabled={locked || undefined}
                aria-describedby={locked ? `${listId}-seat-note` : undefined}
                onClick={() => bench(name)}
                title={locked ? `${name} is the last one in, so they can't be benched yet.` : `Bench ${name}`}
              >
                <svg viewBox="0 0 7 7" width="9" height="9" shapeRendering="crispEdges" aria-hidden="true">
                  <path d="M0 0h1v1h1v1h1v1h1V2h1V1h1V0h1v1H6v1H5v1H4v1h1v1h1v1h1v1H6V6H5V5H4V4H3v1H2v1H1v1H0V6h1V5h1V4h1V3H2V2H1V1H0z" fill="currentColor" />
                </svg>
              </button>
            </span>
          );
        })}
        {benched.map((name) => (
          <button
            key={name}
            type="button"
            className="seat-chip-add"
            style={personaStyle(name)}
            onClick={() => onSeat(name)}
            title={`Seat ${name}, ${PERSONA_META[name]?.archetype ?? "back in the room"}`}
          >
            <span aria-hidden="true">+</span> {name}
            <span className="sr-only">, benched. Seat {name}</span>
          </button>
        ))}
      </div>
      <p className="seat-note" id={`${listId}-seat-note`} data-alert={Boolean(refused)} role="status" aria-live="polite">
        {refused && lastOne
          ? `Someone has to stay in the room. Seat another mind before benching ${lastOne}.`
          : ""}
      </p>

      {(attachLabel || attachStatus) && (
        <div className="attach-status" role="status" aria-live="polite">
          <span>{attachStatus || attachLabel}</span>
          <button type="button" className="text-button" onClick={onDismissAttach}>
            Dismiss
          </button>
        </div>
      )}

      <div className="composer-box">
        <label
          className="attach-button"
          data-disabled={!canAttach}
          title={canAttach ? "Attach a PDF, TXT or MD file (up to 5 MB)" : "Send your first message, then attach files"}
        >
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.txt,.md"
            disabled={!canAttach}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onAttach(file);
            }}
          />
          <svg viewBox="0 0 12 14" width="16" height="19" shapeRendering="crispEdges" aria-hidden="true">
            <path d="M1 0h7v1H1zM0 1h1v13H0zM1 13h10v1H1zM11 4h1v10h-1zM8 1h1v3h3v1H8zM9 2h1v1H9zM3 6h6v1H3zM3 8h6v1H3zM3 10h4v1H3z" fill="currentColor" />
          </svg>
          <span className="sr-only">Attach a file</span>
        </label>

        <div className="composer-field">
          {/* The highlight layer: the same text, with @mentions and /commands coloured. The textarea sits on top. */}
          <div className="composer-mirror" ref={mirrorRef} aria-hidden="true">
            {parsed.segments.map((segment, index) =>
              segment.kind === "text" ? (
                <span key={index}>{segment.text}</span>
              ) : segment.kind === "mention" ? (
                <mark key={index} className="tok tok-mention" style={personaStyle(segment.name)}>
                  {segment.text}
                </mark>
              ) : (
                <mark
                  key={index}
                  className="tok tok-command"
                  style={{ "--heat": pressureFor(segment.mode).heat } as CSSProperties}
                >
                  {segment.text}
                </mark>
              )
            )}
            {/* Keeps a trailing newline as tall as it is in the textarea. */}
            <span>{"​"}</span>
          </div>
          <label className="sr-only" htmlFor="council-prompt">
            Your message
          </label>
          <textarea
            id="council-prompt"
            ref={promptRef}
            rows={1}
            className="composer-input"
            placeholder={placeholder}
            value={prompt}
            aria-autocomplete="list"
            aria-controls={menuOpen ? listId : undefined}
            aria-expanded={menuOpen}
            aria-activedescendant={menuOpen ? `${listId}-${activeIndex}` : undefined}
            aria-describedby={`${listId}-hint`}
            onChange={(event) => {
              onPromptChange(event.target.value);
              setCaret(event.target.selectionStart ?? event.target.value.length);
            }}
            onSelect={syncCaret}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onFocus={() => {
              setFocused(true);
              syncCaret();
            }}
            onBlur={() => setFocused(false)}
            onScroll={(event) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = event.currentTarget.scrollTop;
            }}
          />
        </div>

        <button
          type="button"
          className="send-button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={isSending ? "Council is answering" : sendLabel}
        >
          <span className="send-label">{sendLabel}</span>
          <span className="send-icon" aria-hidden="true">
            ▶
          </span>
        </button>

        {menuOpen && query && (
          <ul className="suggest" id={listId} role="listbox" aria-label={query.kind === "mention" ? "Call a mind" : "Set the pressure"}>
            {suggestions.map((suggestion, index) => {
              const selected = index === activeIndex;
              if (suggestion.kind === "mention") {
                const name = suggestion.name;
                const isBenched = !seated.includes(name);
                return (
                  <li
                    key={name}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    className="suggest-item"
                    data-kind="mention"
                    style={personaStyle(name)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      choose(suggestion);
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <Face name={name} />
                    <strong>@{name}</strong>
                    <span>{isBenched ? "Benched, will be seated" : PERSONA_META[name]?.archetype}</span>
                  </li>
                );
              }
              const stop = pressureFor(suggestion.command.mode);
              return (
                <li
                  key={suggestion.command.word}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  className="suggest-item"
                  data-kind="command"
                  style={{ "--heat": stop.heat } as CSSProperties}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(suggestion);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <HeatBars level={stop.level} />
                  <strong>/{suggestion.command.word}</strong>
                  <span>
                    {stop.name} · {stop.mode}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="composer-hints" id={`${listId}-hint`}>
        {!online && <span className="hint-token hint-offline">You're offline. Sending comes back when you reconnect.</span>}
        {commandStop && (
          <span className="hint-token" style={{ "--heat": commandStop.heat } as CSSProperties}>
            <HeatBars level={commandStop.level} />
            {onlyCommand ? `Press Enter to set ${commandStop.name}` : `Sends at ${commandStop.name}`}
          </span>
        )}
        {mentionsLead && (
          <span className="hint-token">
            {listNames(parsed.mentions)} {parsed.mentions.length === 1 ? "answers" : "answer"}
            {benchedMentions.length > 0 && `, ${listNames(benchedMentions)} will be seated`}
          </span>
        )}
        {!commandStop && !mentionsLead && !prompt && (isFresh || focused) && (
          <span className="hint-quiet">
            Type <kbd>@</kbd> to call one mind, <kbd>/</kbd> to set the pressure
          </span>
        )}
      </p>
    </div>
  );
}
