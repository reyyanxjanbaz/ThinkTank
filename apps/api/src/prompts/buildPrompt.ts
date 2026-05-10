import { getPersona, type PersonaName } from "./personas.js";

export type PromptHistoryItem = {
  speaker: PersonaName | "User";
  content: string;
};

export type BuildPromptInput = {
  persona: PersonaName;
  mode?: string;
  history?: PromptHistoryItem[];
  artifacts?: string[];
  userPrompt: string;
};

const MODE_DESCRIPTIONS: Record<string, string> = {
  Brainstorm: "Rapid ideation and open-ended exploration.",
  "Shark Tank": "Hard questions and feasibility pressure.",
  "Devils Court": "Adversarial critique from every angle.",
  "Co-Founder": "Collaborative building with strategic clarity.",
  Debate: "Personas debate each other while user observes."
};

const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_CHARS = 600;
const MAX_ARTIFACT_ITEMS = 3;
const MAX_ARTIFACT_CHARS = 1200;

const clip = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const formatHistory = (history?: PromptHistoryItem[]) => {
  if (!history || history.length === 0) {
    return "";
  }

  const recentHistory = history.slice(-MAX_HISTORY_ITEMS);
  const lines = recentHistory.map(
    (item) => `${item.speaker}: ${clip(item.content, MAX_HISTORY_CHARS)}`
  );
  return ["Council history:", ...lines].join("\n");
};

const formatArtifacts = (artifacts?: string[]) => {
  if (!artifacts || artifacts.length === 0) {
    return "";
  }

  const lines = artifacts
    .slice(0, MAX_ARTIFACT_ITEMS)
    .map(
      (artifact, index) =>
        `Artifact ${index + 1}: ${clip(artifact, MAX_ARTIFACT_CHARS)}`
    );
  return ["Artifacts:", ...lines].join("\n");
};

export const buildSystemPrompt = ({
  persona,
  mode
}: Pick<BuildPromptInput, "persona" | "mode">) => {
  const personaCard = getPersona(persona);
  const parts = [personaCard.systemPrompt];

  if (mode) {
    const description = MODE_DESCRIPTIONS[mode] ?? "";
    parts.push(`Mode: ${mode}${description ? ` - ${description}` : ""}`);
  }

  parts.push(
    "Never dump raw source documents, artifact text, or full user prompts.",
    "Summarize and reason from context; use short quotes only when necessary.",
    "If context is long, extract key points and continue with analysis.",
    "Respond in plain text only.",
    "Do not use markdown, headings, bullets, numbered lists, or asterisks."
  );

  return parts.join("\n\n");
};

export const buildContextPrompt = ({
  history,
  artifacts,
  userPrompt
}: Pick<BuildPromptInput, "history" | "artifacts" | "userPrompt">) => {
  const parts: string[] = [];

  const historyBlock = formatHistory(history);
  if (historyBlock) {
    parts.push(historyBlock);
  }

  const artifactBlock = formatArtifacts(artifacts);
  if (artifactBlock) {
    parts.push(artifactBlock);
  }

  parts.push(`User request:\n${clip(userPrompt, 2000)}`);

  return parts.join("\n\n");
};

export const buildPrompt = ({
  persona,
  mode,
  history,
  artifacts,
  userPrompt
}: BuildPromptInput) => {
  const system = buildSystemPrompt({ persona, mode });
  const context = buildContextPrompt({ history, artifacts, userPrompt });
  return `${system}\n\n${context}`;
};
