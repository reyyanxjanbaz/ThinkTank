import crypto from "crypto";
import type {
  Artifact,
  AddArtifactInput,
  AddExportInput,
  AddTurnInput,
  CreateSessionInput,
  ExportRecord,
  Session,
  Turn,
  UpdateArtifactInput
} from "./types.js";

type StoredSession = Session & { userId?: string };

const sessions: StoredSession[] = [];
const turns: Turn[] = [];
const artifacts: Artifact[] = [];
const exports: ExportRecord[] = [];

const now = () => new Date().toISOString();

const stripSession = ({ userId: _userId, ...session }: StoredSession): Session => session;

const findSession = (id: string, userId?: string) =>
  sessions.find(
    (session) =>
      session.id === id && (userId === undefined || session.userId === userId)
  );

const touchSession = (sessionId: string) => {
  const session = sessions.find((item) => item.id === sessionId);
  if (session) {
    session.updatedAt = now();
  }
};

export const listSessions = async (userId?: string) =>
  sessions.filter((session) => !userId || session.userId === userId).map(stripSession);

export const getSession = async (id: string, userId?: string) => {
  const session = findSession(id, userId);
  return session ? stripSession(session) : null;
};

export const createSession = async (input: CreateSessionInput) => {
  const session: StoredSession = {
    id: crypto.randomUUID(),
    title: input.title ?? null,
    mode: input.mode ?? null,
    status: input.status ?? "active",
    createdAt: now(),
    updatedAt: now(),
    userId: input.userId
  };
  sessions.unshift(session);
  return stripSession(session);
};

export const listTurns = async (sessionId: string) =>
  turns.filter((turn) => turn.sessionId === sessionId);

export const addTurn = async (input: AddTurnInput) => {
  const orderIndex = (await listTurns(input.sessionId)).length + 1;
  const turn: Turn = {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    persona: input.persona,
    role: input.role ?? null,
    content: input.content,
    tokens: input.tokens ?? null,
    createdAt: now(),
    orderIndex
  };
  turns.push(turn);
  touchSession(input.sessionId);
  return turn;
};

export const listArtifacts = async (sessionId: string) =>
  artifacts.filter((artifact) => artifact.sessionId === sessionId);

export const addArtifact = async (input: AddArtifactInput) => {
  const artifact: Artifact = {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    filename: input.filename,
    mime: input.mime,
    size: input.size,
    status: input.status ?? "uploaded",
    parsedText: input.parsedText ?? null,
    createdAt: now()
  };
  artifacts.push(artifact);
  touchSession(input.sessionId);
  return artifact;
};

export const updateArtifact = async (
  artifactId: string,
  input: UpdateArtifactInput
) => {
  const artifact = artifacts.find((item) => item.id === artifactId);
  if (!artifact) {
    return null;
  }

  if (input.status) {
    artifact.status = input.status;
  }

  if (input.parsedText !== undefined) {
    artifact.parsedText = input.parsedText;
  }

  touchSession(artifact.sessionId);
  return artifact;
};

export const listExports = async (sessionId: string) =>
  exports.filter((record) => record.sessionId === sessionId);

export const addExport = async (input: AddExportInput) => {
  const id = crypto.randomUUID();
  const record: ExportRecord = {
    id,
    sessionId: input.sessionId,
    format: input.format,
    storagePath: input.storagePath ?? `exports/${input.sessionId}/${id}.${input.format}`,
    createdAt: now()
  };
  exports.push(record);
  touchSession(input.sessionId);
  return record;
};
