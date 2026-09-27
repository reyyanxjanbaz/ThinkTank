import { supabase } from "../lib/supabase.js";
import type {
  Artifact,
  AddArtifactInput,
  AddExportInput,
  AddTurnInput,
  CreateSessionInput,
  ExportFormat,
  ExportRecord,
  Session,
  SessionStatus,
  Turn,
  UpdateArtifactInput
} from "./types.js";
import { summarizeSession } from "./summary.js";

const ensureClient = () => {
  if (!supabase) {
    throw new Error("Supabase not configured");
  }
  return supabase;
};

const mapSession = (row: {
  id: string;
  title: string | null;
  mode: string | null;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
}): Session => ({
  id: row.id,
  title: row.title,
  mode: row.mode,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapTurn = (row: {
  id: string;
  session_id: string;
  persona: string;
  role: string | null;
  content: string;
  tokens: number | null;
  created_at: string;
  order_index: number;
}): Turn => ({
  id: row.id,
  sessionId: row.session_id,
  persona: row.persona,
  role: row.role,
  content: row.content,
  tokens: row.tokens,
  createdAt: row.created_at,
  orderIndex: row.order_index
});

const mapArtifact = (row: {
  id: string;
  session_id: string;
  filename: string;
  mime: string;
  size: number;
  status: Artifact["status"];
  parsed_text: string | null;
  created_at: string;
}): Artifact => ({
  id: row.id,
  sessionId: row.session_id,
  filename: row.filename,
  mime: row.mime,
  size: row.size,
  status: row.status,
  parsedText: row.parsed_text,
  createdAt: row.created_at
});

const mapExport = (row: {
  id: string;
  session_id: string;
  format: ExportFormat;
  storage_path: string;
  created_at: string;
}): ExportRecord => ({
  id: row.id,
  sessionId: row.session_id,
  format: row.format,
  storagePath: row.storage_path,
  createdAt: row.created_at
});

// When session_summaries is missing (migration not applied yet), skip the RPC
// for a while, then look again so applying the migration takes effect without a restart.
const SUMMARIES_RECHECK_MS = 5 * 60 * 1000;
let summariesRetryAt = 0;

const isMissingFunction = (error: { code?: string; message: string }) =>
  error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message);

export const listSessions = async (userId?: string) => {
  if (!userId) {
    throw new Error("Missing userId");
  }
  const client = ensureClient();
  const sessionsQuery = client
    .from("sessions")
    .select("id,title,mode,status,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  // Light path: the database counts turns and lists speakers (migration 2026092701_session_summaries).
  if (Date.now() >= summariesRetryAt) {
    const [sessionsResult, summariesResult] = await Promise.all([
      sessionsQuery,
      client.rpc("session_summaries", { p_user_id: userId })
    ]);
    if (sessionsResult.error) {
      throw new Error(sessionsResult.error.message);
    }
    if (!summariesResult.error) {
      const byId = new Map(
        ((summariesResult.data ?? []) as Array<{ session_id: string; turn_count: number; speakers: string[] | null }>).map(
          (row) => [row.session_id, row]
        )
      );
      return (sessionsResult.data ?? []).map((row) => {
        const summary = byId.get(row.id);
        return { ...mapSession(row), turnCount: summary?.turn_count ?? 0, speakers: summary?.speakers ?? [] };
      });
    }
    if (isMissingFunction(summariesResult.error)) {
      // Only a missing function backs off; a transient error just falls back for this request.
      if (summariesRetryAt === 0) {
        console.warn(
          `[sessions] session_summaries unavailable (${summariesResult.error.message}); counting from embedded turns instead.`
        );
      }
      summariesRetryAt = Date.now() + SUMMARIES_RECHECK_MS;
    }
  }

  // Fallback: embed each session's turns (persona + order only) and count here.
  const { data, error } = await client
    .from("sessions")
    .select("id,title,mode,status,created_at,updated_at,turns(persona,order_index)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(({ turns, ...row }) =>
    summarizeSession(
      mapSession(row),
      (turns ?? []).map((turn) => ({ persona: turn.persona, orderIndex: turn.order_index }))
    )
  );
};

export const deleteSession = async (id: string, userId?: string) => {
  if (!userId) {
    throw new Error("Missing userId");
  }
  const client = ensureClient();
  // Turns, artifacts and export rows go with it (on delete cascade).
  const { data, error } = await client
    .from("sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).length > 0;
};

export const getSession = async (id: string, userId?: string) => {
  if (!userId) {
    throw new Error("Missing userId");
  }
  const client = ensureClient();
  const { data, error } = await client
    .from("sessions")
    .select("id,title,mode,status,created_at,updated_at")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  return mapSession(data);
};

export const createSession = async (input: CreateSessionInput) => {
  if (!input.userId) {
    throw new Error("Missing userId");
  }
  const client = ensureClient();
  const { data, error } = await client
    .from("sessions")
    .insert({
      user_id: input.userId,
      title: input.title ?? null,
      mode: input.mode ?? null,
      status: input.status ?? "active"
    })
    .select("id,title,mode,status,created_at,updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapSession(data);
};

export const updateSessionTitle = async (id: string, title: string, userId?: string) => {
  if (!userId) {
    throw new Error("Missing userId");
  }
  const client = ensureClient();
  const { data, error } = await client
    .from("sessions")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id,title,mode,status,created_at,updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapSession(data) : null;
};

export const listTurns = async (sessionId: string) => {
  const client = ensureClient();
  const { data, error } = await client
    .from("turns")
    .select("id,session_id,persona,role,content,tokens,created_at,order_index")
    .eq("session_id", sessionId)
    .order("order_index", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapTurn);
};

export const addTurn = async (input: AddTurnInput) => {
  const client = ensureClient();
  const { data: latest, error: latestError } = await client
    .from("turns")
    .select("order_index")
    .eq("session_id", input.sessionId)
    .order("order_index", { ascending: false })
    .limit(1);

  if (latestError) {
    throw new Error(latestError.message);
  }

  const orderIndex = (latest?.[0]?.order_index ?? 0) + 1;
  const { data, error } = await client
    .from("turns")
    .insert({
      session_id: input.sessionId,
      persona: input.persona,
      role: input.role ?? null,
      content: input.content,
      tokens: input.tokens ?? null,
      order_index: orderIndex
    })
    .select("id,session_id,persona,role,content,tokens,created_at,order_index")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapTurn(data);
};

export const listArtifacts = async (sessionId: string) => {
  const client = ensureClient();
  const { data, error } = await client
    .from("artifacts")
    .select("id,session_id,filename,mime,size,status,parsed_text,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapArtifact);
};

export const addArtifact = async (input: AddArtifactInput) => {
  const client = ensureClient();
  const { data, error } = await client
    .from("artifacts")
    .insert({
      session_id: input.sessionId,
      filename: input.filename,
      mime: input.mime,
      size: input.size,
      status: input.status ?? "uploaded",
      parsed_text: input.parsedText ?? null
    })
    .select("id,session_id,filename,mime,size,status,parsed_text,created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapArtifact(data);
};

export const updateArtifact = async (
  artifactId: string,
  input: UpdateArtifactInput
) => {
  const updates: { status?: Artifact["status"]; parsed_text?: string | null } = {};
  if (input.status !== undefined) {
    updates.status = input.status;
  }
  if (input.parsedText !== undefined) {
    updates.parsed_text = input.parsedText;
  }

  const client = ensureClient();
  const { data, error } = await client
    .from("artifacts")
    .update(updates)
    .eq("id", artifactId)
    .select("id,session_id,filename,mime,size,status,parsed_text,created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapArtifact(data);
};

export const listExports = async (sessionId: string) => {
  const client = ensureClient();
  const { data, error } = await client
    .from("exports")
    .select("id,session_id,format,storage_path,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map(mapExport);
};

export const addExport = async (input: AddExportInput) => {
  const client = ensureClient();
  const storagePath =
    input.storagePath ?? `exports/${input.sessionId}/${Date.now()}.${input.format}`;
  const { data, error } = await client
    .from("exports")
    .insert({
      session_id: input.sessionId,
      format: input.format,
      storage_path: storagePath
    })
    .select("id,session_id,format,storage_path,created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapExport(data);
};
