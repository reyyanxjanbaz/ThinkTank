export type SessionStatus = "active" | "archived";

export type Session = {
  id: string;
  title: string | null;
  mode: string | null;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
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

export type ArtifactStatus = "uploaded" | "parsing" | "ready" | "failed";

export type Artifact = {
  id: string;
  sessionId: string;
  filename: string;
  mime: string;
  size: number;
  status: ArtifactStatus;
  parsedText: string | null;
  createdAt: string;
};

export type ExportFormat = "md" | "pdf";

export type ExportRecord = {
  id: string;
  sessionId: string;
  format: ExportFormat;
  storagePath: string;
  createdAt: string;
};

export type CreateSessionInput = {
  title?: string | null;
  mode?: string | null;
  status?: SessionStatus;
  userId?: string;
};

export type AddTurnInput = {
  sessionId: string;
  persona: string;
  role?: string | null;
  content: string;
  tokens?: number | null;
};

export type AddArtifactInput = {
  sessionId: string;
  filename: string;
  mime: string;
  size: number;
  status?: Artifact["status"];
  parsedText?: string | null;
};

export type UpdateArtifactInput = {
  status?: Artifact["status"];
  parsedText?: string | null;
};

export type AddExportInput = {
  sessionId: string;
  format: ExportFormat;
  storagePath?: string;
};

export type Store = {
  listSessions: (userId?: string) => Promise<Session[]>;
  getSession: (id: string, userId?: string) => Promise<Session | null>;
  createSession: (input: CreateSessionInput) => Promise<Session>;
  listTurns: (sessionId: string) => Promise<Turn[]>;
  addTurn: (input: AddTurnInput) => Promise<Turn>;
  listArtifacts: (sessionId: string) => Promise<Artifact[]>;
  addArtifact: (input: AddArtifactInput) => Promise<Artifact>;
  updateArtifact: (
    artifactId: string,
    input: UpdateArtifactInput
  ) => Promise<Artifact | null>;
  listExports: (sessionId: string) => Promise<ExportRecord[]>;
  addExport: (input: AddExportInput) => Promise<ExportRecord>;
};
