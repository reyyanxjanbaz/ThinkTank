import type { Session, SessionSummary } from "./types.js";

type TurnLike = { persona: string; orderIndex: number };

// Counts persona replies and lists who spoke, in speaking order. "User" turns are the asker, not the council.
export const summarizeSession = (session: Session, turns: TurnLike[]): SessionSummary => {
  const replies = turns
    .filter((turn) => turn.persona !== "User")
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const speakers: string[] = [];
  for (const turn of replies) {
    if (!speakers.includes(turn.persona)) speakers.push(turn.persona);
  }
  return { ...session, turnCount: replies.length, speakers };
};
