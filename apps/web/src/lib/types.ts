export type Persona = {
  name: string;
  role: string;
  tagline: string;
  focus: string;
};

export type Session = {
  id: string;
  title: string | null;
  mode: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  /** Persona replies so far. Sent by the council list; missing on local drafts. */
  turnCount?: number;
  /** Personas who have replied, in the order they first spoke. */
  speakers?: string[];
};

export type Turn = {
  id: string;
  sessionId: string;
  persona: string;
  role: string | null;
  content: string;
  tokens: number | null;
  createdAt: string;
  orderIndex: number;
};
