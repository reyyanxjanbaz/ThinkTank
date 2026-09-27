// Typed shortcuts in the composer: "@Bucks" picks who answers, "/court" sets the pressure.
// One parser feeds the input highlight, the autocomplete menu and the send path, so they never disagree.

export type PressureCommand = {
  /** What people type after the slash. */
  word: string;
  /** Other spellings that do the same thing. */
  aliases: string[];
  /** The session mode it selects. */
  mode: string;
};

export const COMMANDS: PressureCommand[] = [
  { word: "brainstorm", aliases: ["storm", "open"], mode: "Brainstorm" },
  { word: "cofounder", aliases: ["co-founder", "warm", "build"], mode: "Co-Founder" },
  { word: "shark", aliases: ["sharktank", "pitch", "hot"], mode: "Shark Tank" },
  { word: "court", aliases: ["devilscourt", "trial", "fire"], mode: "Devils Court" }
];

export const commandForMode = (mode: string) => COMMANDS.find((command) => command.mode === mode);

const findCommand = (word: string) => {
  const lower = word.toLowerCase();
  return COMMANDS.find((command) => command.word === lower || command.aliases.includes(lower));
};

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; name: string }
  | { kind: "command"; text: string; mode: string };

export type ParsedPrompt = {
  /** The pressure the leading /command asks for, if there is one. */
  command: { mode: string; word: string } | null;
  /** Personas called with @, in the order they were typed, without repeats. */
  mentions: string[];
  /** The message with the leading /command removed: what gets sent. */
  message: string;
  /** The raw prompt cut into plain text and tokens, for the highlight layer. */
  segments: Segment[];
};

const COMMAND_RE = /^(\s*)\/([a-z-]+)(?=\s|$)/i;

export const parsePrompt = (prompt: string, personaNames: string[]): ParsedPrompt => {
  const segments: Segment[] = [];
  let rest = prompt;
  let command: ParsedPrompt["command"] = null;

  const leading = COMMAND_RE.exec(prompt);
  const matched = leading ? findCommand(leading[2]) : undefined;
  if (leading && matched) {
    if (leading[1]) segments.push({ kind: "text", text: leading[1] });
    const text = `/${leading[2]}`;
    segments.push({ kind: "command", text, mode: matched.mode });
    command = { mode: matched.mode, word: leading[2] };
    rest = prompt.slice(leading[0].length);
  }

  const mentions: string[] = [];
  const byLower = new Map(personaNames.map((name) => [name.toLowerCase(), name]));
  // A mention starts at the beginning or after whitespace/an opening bracket, and ends at a word boundary.
  const mentionRe = /(^|[\s(\[{"'])@([A-Za-z]+)\b/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = mentionRe.exec(rest))) {
    const name = byLower.get(match[2].toLowerCase());
    if (!name) continue;
    const start = match.index + match[1].length;
    if (start > cursor) segments.push({ kind: "text", text: rest.slice(cursor, start) });
    segments.push({ kind: "mention", text: rest.slice(start, start + 1 + match[2].length), name });
    cursor = start + 1 + match[2].length;
    if (!mentions.includes(name)) mentions.push(name);
  }
  if (cursor < rest.length) segments.push({ kind: "text", text: rest.slice(cursor) });

  return { command, mentions, message: rest.trim(), segments };
};

export type Suggestion =
  | { kind: "mention"; name: string }
  | { kind: "command"; command: PressureCommand };

export type SuggestionQuery = {
  kind: "mention" | "command";
  /** Where the trigger character sits in the prompt. */
  start: number;
  /** What has been typed after the trigger. */
  query: string;
};

/** Is the caret in the middle of typing an @name or a leading /command? */
export const suggestionAt = (prompt: string, caret: number): SuggestionQuery | null => {
  const before = prompt.slice(0, caret);
  const command = /^(\s*)\/([a-z-]*)$/i.exec(before);
  if (command) return { kind: "command", start: command[1].length, query: command[2].toLowerCase() };
  const mention = /(^|[\s(\[{"'])@([A-Za-z]*)$/.exec(before);
  if (mention) {
    return { kind: "mention", start: before.length - mention[2].length - 1, query: mention[2].toLowerCase() };
  }
  return null;
};

export const suggestionsFor = (query: SuggestionQuery, personaNames: string[]): Suggestion[] => {
  if (query.kind === "command") {
    return COMMANDS.filter(
      (command) =>
        command.word.startsWith(query.query) || command.aliases.some((alias) => alias.startsWith(query.query))
    ).map((command) => ({ kind: "command" as const, command }));
  }
  return personaNames
    .filter((name) => name.toLowerCase().startsWith(query.query))
    .map((name) => ({ kind: "mention" as const, name }));
};

/** Replaces the half-typed token with the chosen one and returns the new prompt and caret. */
export const applySuggestion = (prompt: string, caret: number, query: SuggestionQuery, suggestion: Suggestion) => {
  const token = suggestion.kind === "mention" ? `@${suggestion.name}` : `/${suggestion.command.word}`;
  const after = prompt.slice(caret).replace(/^[A-Za-z-]*/, "");
  const spaced = after.startsWith(" ") ? after : ` ${after}`;
  const next = `${prompt.slice(0, query.start)}${token}${spaced}`;
  return { prompt: next, caret: query.start + token.length + 1 };
};
