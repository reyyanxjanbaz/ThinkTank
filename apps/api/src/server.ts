import { isProduction } from "./lib/env.js";
import Fastify, { type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { PERSONA_NAMES, getPublicPersonas } from "./prompts/personas.js";
import {
  buildContextPrompt,
  FOLLOW_UP_REQUEST,
  buildPrompt,
  buildSystemPrompt,
  type PromptHistoryItem
} from "./prompts/buildPrompt.js";
import {
  parseArtifactBuffer,
  detectArtifactKind,
  limitText
} from "./lib/artifactParser.js";
import { buildSessionMarkdown, renderPdfBuffer } from "./lib/exports.js";
import {
  openaiBaseUrl,
  openaiProvider,
  hasOpenAIConfig,
  openai,
  openaiModel,
  openaiTemperature
} from "./lib/openai.js";
import { hasSupabaseConfig, supabase } from "./lib/supabase.js";
import * as memoryStore from "./store/memoryStore.js";
import * as supabaseStore from "./store/supabaseStore.js";
import type { Store } from "./store/types.js";

// Behind a hosting proxy (Render, Fly, Railway) the client IP arrives in X-Forwarded-For;
// rate limiting keys on it, so trust the proxy only when told to.
const parseTrustProxy = () => {
  const value = (process.env.TRUST_PROXY ?? "").trim().toLowerCase();
  if (value === "true") return true;
  const hops = Number.parseInt(value, 10);
  return Number.isFinite(hops) && hops > 0 ? hops : false;
};

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL?.trim() || "info" },
  // JSON bodies are small (prompts cap at a few thousand characters); uploads use multipart limits below.
  bodyLimit: 1024 * 1024,
  trustProxy: parseTrustProxy()
});

// Treat an empty application/json body as "no body" instead of a 400, so
// body-less requests (DELETE) work even when a client sends the header.
// Everything else goes through Fastify's own parser, which rejects __proto__
// and constructor.prototype keys.
const defaultJsonParser = app.getDefaultJsonParser("error", "error");
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
  if (typeof body === "string" && body.trim() === "") {
    done(null, undefined);
    return;
  }
  defaultJsonParser(request, body as string, done);
});

const allowMemoryStoreByDefault = isProduction ? "false" : "true";
const allowMemoryStore =
  (process.env.ALLOW_MEMORY_STORE ?? allowMemoryStoreByDefault).toLowerCase() ===
  "true";

// Development allows any origin when CORS_ORIGIN is empty; production requires an explicit
// list (checked in lib/env.ts), so it never reflects arbitrary origins.
const parseCorsOrigin = () => {
  const values = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (values.length === 0) {
    return !isProduction;
  }
  return values;
};

await app.register(cors, { origin: parseCorsOrigin() });

// Only the routes that call the LLM opt in (config.rateLimit), so reads stay unthrottled.
const RATE_LIMIT_MAX = (() => {
  const parsed = Number.parseInt(process.env.RATE_LIMIT_MAX ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
})();
await app.register(rateLimit, { global: false });
const llmRateLimit = { rateLimit: { max: RATE_LIMIT_MAX, timeWindow: "1 minute" } };

// Client errors keep their message; anything unexpected is logged and answered generically,
// so internal details and stack traces never reach the browser.
app.setErrorHandler((error, request, reply) => {
  const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error({ err: error }, "request failed");
    return reply.code(statusCode).send({ error: "server_error" });
  }
  return reply.code(statusCode).send({
    error: statusCode === 429 ? "rate_limited" : error.code ?? "bad_request",
    message: error.message
  });
});

const MAX_ARTIFACT_BYTES = (() => {
  const parsed = Number.parseInt(process.env.MAX_ARTIFACT_SIZE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024;
})();

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "artifacts";
const EXPORT_BUCKET = process.env.SUPABASE_EXPORT_BUCKET ?? "exports";
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._ -]/g;

const normalizeUploadedFilename = (value: string) => {
  const trimmed = value.trim().replaceAll("\\", "/");
  const basename = trimmed.split("/").pop() ?? "artifact";
  const sanitized = basename
    .replace(UNSAFE_FILENAME_CHARS, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "artifact";
};

const inferContentType = (kind: "pdf" | "text", filename: string) => {
  if (kind === "pdf") {
    return "application/pdf";
  }
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".md")) {
    return "text/markdown";
  }
  return "text/plain";
};

await app.register(multipart, {
  limits: {
    fileSize: MAX_ARTIFACT_BYTES,
    files: 1
  }
});

const PersonaSchema = z.enum(PERSONA_NAMES);
const SpeakerSchema = z.union([PersonaSchema, z.literal("User")]);

const PromptSchema = z.object({
  sessionId: z.string().uuid().optional(),
  persona: PersonaSchema,
  prompt: z.string().min(1).max(4000)
});

const PromptPreviewSchema = z.object({
  persona: PersonaSchema,
  mode: z.string().min(1).max(32).optional(),
  history: z
    .array(
      z.object({
        speaker: SpeakerSchema,
        content: z.string().min(1).max(8000)
      })
    )
    .max(40)
    .optional(),
  artifacts: z.array(z.string().min(1).max(12000)).max(10).optional(),
  userPrompt: z.string().min(1).max(4000)
});

const StreamSchema = z.object({
  persona: PersonaSchema,
  mode: z.string().min(1).max(32).optional(),
  prompt: z.string().min(1).max(4000),
  // Set when several personas answer the same prompt in a row, so the user
  // turn is stored once rather than once per persona.
  followUp: z.boolean().optional()
});

const GuestStreamSchema = StreamSchema.extend({
  history: z
    .array(
      z.object({
        speaker: SpeakerSchema,
        content: z.string().min(1).max(8000)
      })
    )
    .max(20)
    .optional()
});

const SessionCreateSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  mode: z.string().min(1).max(32).optional()
});

const TitleRequestSchema = z.object({
  prompt: z.string().min(1).max(4000)
});

const SessionTitleSchema = z.object({
  title: z.string().trim().min(1).max(80)
});

// Keep model output to a clean, short label: no quotes, no trailing punctuation.
const cleanTitle = (raw: string) =>
  raw
    .split("\n")[0]
    .replace(/^(title|topic)\s*:\s*/i, "")
    .replace(/["'`*_#]/g, "")
    .replace(/[.!?:;,]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

const TurnCreateSchema = z.object({
  persona: PersonaSchema,
  role: z.string().min(1).max(40).optional(),
  content: z.string().min(1).max(8000),
  tokens: z.number().int().min(0).max(20000).optional()
});

const ArtifactCreateSchema = z.object({
  filename: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  size: z.number().int().min(1).max(15 * 1024 * 1024)
});

const ExportCreateSchema = z.object({
  format: z.enum(["md", "pdf"])
});

const BLOCKLIST: RegExp[] = [
  /ignore\s+previous/i,
  /system\s+prompt/i,
  /developer\s+message/i
];

const isBlocked = (value: string) => BLOCKLIST.some((rule) => rule.test(value));

if (!hasSupabaseConfig && !allowMemoryStore) {
  throw new Error(
    "Supabase is not configured and ALLOW_MEMORY_STORE is false. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or explicitly set ALLOW_MEMORY_STORE=true."
  );
}

const store: Store = hasSupabaseConfig ? supabaseStore : memoryStore;

const requireUserId = async (request: { headers: { authorization?: string } }, reply: {
  code: (status: number) => { send: (body: Record<string, string>) => void };
}) => {
  if (!hasSupabaseConfig) {
    return "local-user";
  }

  const authHeader = request.headers.authorization ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }

  const token = authHeader.slice(7);
  const { data, error } = await supabase!.auth.getUser(token);

  if (error || !data.user) {
    reply.code(401).send({ error: "unauthorized" });
    return null;
  }

  return data.user.id;
};

const handleStoreError = (reply: {
  code: (status: number) => { send: (body: Record<string, string>) => void };
}, error: unknown) => {
  app.log.error({ err: error }, "store request failed");
  reply.code(500).send({ error: "server_error" });
};

type StreamError = Error & {
  status?: number;
  code?: string;
};

const getStreamErrorCode = (error: unknown) => {
  const streamError = error as Partial<StreamError>;
  if (streamError.status === 401 || streamError.code === "invalid_api_key") {
    return "openai_auth_failed";
  }
  if (streamError.status === 402) {
    return "openai_payment_required";
  }
  if (streamError.status === 403) {
    return "openai_forbidden";
  }
  if (streamError.status === 429) {
    return "openai_rate_limited";
  }
  return "stream_failed";
};

const logStreamError = (error: unknown, message: string) => {
  if (error instanceof Error) {
    const streamError = error as StreamError;
    app.log.error(
      {
        err: {
          name: error.name,
          message:
            getStreamErrorCode(error) === "openai_auth_failed"
              ? "OpenAI authentication failed"
              : getStreamErrorCode(error) === "openai_payment_required"
                ? "Provider credits/payment required"
              : error.message,
          status: streamError.status,
          code: streamError.code
        }
      },
      message
    );
    return;
  }

  app.log.error({ err: error }, message);
};

// Hijacking skips Fastify's header pipeline, so copy the headers plugins already set
// (CORS, rate limit) onto the raw response; without them a cross-origin stream is blocked.
// no-transform and X-Accel-Buffering stop proxies from compressing or buffering the stream.
const openEventStream = (reply: FastifyReply) => {
  const pending = reply.getHeaders();
  reply.hijack();
  for (const [name, value] of Object.entries(pending)) {
    if (value !== undefined) {
      reply.raw.setHeader(name, value as string | number | string[]);
    }
  }
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.flushHeaders?.();
};

app.get("/health", async () => ({
  status: "ok",
  time: new Date().toISOString(),
  llmConfigured: hasOpenAIConfig,
  llmProvider: openaiProvider,
  persistence: hasSupabaseConfig ? "supabase" : "memory"
}));

app.get("/api/llm/status", async () => ({
  configured: hasOpenAIConfig,
  provider: openaiProvider,
  model: openaiModel,
  baseUrl: openaiBaseUrl,
  temperature: openaiTemperature
}));

app.get("/api/personas", async () => ({
  personas: getPublicPersonas()
}));

app.post("/api/validate-prompt", async (request, reply) => {
  const parsed = PromptSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: parsed.error.issues
    });
  }

  if (isBlocked(parsed.data.prompt)) {
    return reply.code(400).send({
      error: "blocked_prompt"
    });
  }

  return { ok: true };
});

app.post("/api/prompt-preview", async (request, reply) => {
  if (process.env.PROMPT_PREVIEW !== "true") {
    return reply.code(403).send({
      error: "prompt_preview_disabled"
    });
  }

  const parsed = PromptPreviewSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: parsed.error.issues
    });
  }

  const { userPrompt, history, artifacts, persona, mode } = parsed.data;
  const historyItems = history ?? [];
  const blocked = [userPrompt, ...historyItems.map((item) => item.content)].some(
    isBlocked
  );

  if (blocked) {
    return reply.code(400).send({
      error: "blocked_prompt"
    });
  }

  const prompt = buildPrompt({
    persona,
    mode,
    history: historyItems as PromptHistoryItem[],
    artifacts,
    userPrompt
  });

  return { prompt };
});

app.post("/api/guest/stream", { config: llmRateLimit }, async (request, reply) => {
  if (!hasOpenAIConfig || !openai) {
    return reply.code(503).send({
      error: "openai_not_configured"
    });
  }

  const parsed = GuestStreamSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: parsed.error.issues
    });
  }

  const history = parsed.data.history ?? [];
  const blocked = [parsed.data.prompt, ...history.map((item) => item.content)].some(
    isBlocked
  );

  if (blocked) {
    return reply.code(400).send({
      error: "blocked_prompt"
    });
  }

  const systemPrompt = buildSystemPrompt({
    persona: parsed.data.persona,
    mode: parsed.data.mode
  });
  // Guest follow-ups send the round's question inside history, so don't restate it.
  const contextPrompt = buildContextPrompt({
    history: history as PromptHistoryItem[],
    userPrompt: parsed.data.followUp ? FOLLOW_UP_REQUEST : parsed.data.prompt
  });

  let onClose: (() => void) | null = null;

  try {
    openEventStream(reply);

    let closed = false;
    const abortController = new AbortController();
    onClose = () => {
      closed = true;
      abortController.abort();
    };
    reply.raw.on("close", onClose);

    const stream = await openai.chat.completions.create(
      {
        model: openaiModel,
        temperature: openaiTemperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextPrompt }
        ],
        stream: true
      },
      { signal: abortController.signal }
    );

    for await (const chunk of stream) {
      if (closed) {
        break;
      }
      const token = chunk.choices[0]?.delta?.content;
      if (!token) {
        continue;
      }
      reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    if (!closed) {
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    logStreamError(error, "guest stream failed");
    if (!reply.raw.headersSent) {
      return reply.code(500).send({ error: "server_error" });
    }
    reply.raw.write(`data: ${JSON.stringify({ error: getStreamErrorCode(error) })}\n\n`);
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
  } finally {
    if (onClose) {
      reply.raw.off("close", onClose);
    }
  }
});

app.post("/api/sessions/:sessionId/stream", { config: llmRateLimit }, async (request, reply) => {
  if (!hasOpenAIConfig || !openai) {
    return reply.code(503).send({
      error: "openai_not_configured"
    });
  }

  const parsed = StreamSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: parsed.error.issues
    });
  }

  if (isBlocked(parsed.data.prompt)) {
    return reply.code(400).send({
      error: "blocked_prompt"
    });
  }

  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  let onClose: (() => void) | null = null;
  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    const [turns, artifacts] = await Promise.all([
      store.listTurns(sessionId),
      store.listArtifacts(sessionId)
    ]);

    const history: PromptHistoryItem[] = turns.map((turn) => ({
      speaker: turn.persona as PromptHistoryItem["speaker"],
      content: turn.content
    }));

    // A follow-up in an "everyone" round only skips storing the user turn when an
    // earlier speaker's request actually stored it; otherwise the question would be lost.
    const lastUserTurn = [...turns].reverse().find((turn) => turn.persona === "User");
    const userTurnStored = Boolean(
      parsed.data.followUp && lastUserTurn?.content === parsed.data.prompt
    );

    const artifactTexts = artifacts
      .filter((artifact) => artifact.status === "ready" && artifact.parsedText)
      .map((artifact) => limitText(artifact.parsedText ?? ""))
      .filter(Boolean);

    const systemPrompt = buildSystemPrompt({
      persona: parsed.data.persona,
      mode: parsed.data.mode ?? session.mode ?? undefined
    });
    const contextPrompt = buildContextPrompt({
      history,
      artifacts: artifactTexts,
      userPrompt: userTurnStored ? FOLLOW_UP_REQUEST : parsed.data.prompt
    });
    if (!userTurnStored) {
      await store.addTurn({
        sessionId,
        persona: "User",
        content: parsed.data.prompt
      });
    }

    openEventStream(reply);

    let closed = false;
    const abortController = new AbortController();
    onClose = () => {
      closed = true;
      abortController.abort();
    };
    reply.raw.on("close", onClose);

    const stream = await openai.chat.completions.create(
      {
        model: openaiModel,
        temperature: openaiTemperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextPrompt }
        ],
        stream: true
      },
      { signal: abortController.signal }
    );

    let fullText = "";

    for await (const chunk of stream) {
      if (closed) {
        break;
      }
      const token = chunk.choices[0]?.delta?.content;
      if (!token) {
        continue;
      }
      fullText += token;
      reply.raw.write(`data: ${JSON.stringify({ token })}\n\n`);
    }

    if (!closed) {
      reply.raw.write("data: [DONE]\n\n");
      reply.raw.end();
    }

    if (!closed && fullText.trim()) {
      await store.addTurn({
        sessionId,
        persona: parsed.data.persona,
        content: fullText
      });
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }
    logStreamError(error, "session stream failed");
    if (!reply.raw.headersSent) {
      return reply.code(500).send({ error: "server_error" });
    }
    reply.raw.write(`data: ${JSON.stringify({ error: getStreamErrorCode(error) })}\n\n`);
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
  } finally {
    if (onClose) {
      reply.raw.off("close", onClose);
    }
  }
});

app.post("/api/sessions/:sessionId/exports/generate", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  const parsed = ExportCreateSchema.safeParse(request.body);

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: parsed.error.issues
    });
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    const [turns, artifacts] = await Promise.all([
      store.listTurns(sessionId),
      store.listArtifacts(sessionId)
    ]);

    const markdown = buildSessionMarkdown(session, turns, artifacts);
    const filenameBase = `think-tank-${sessionId}`;

    if (parsed.data.format === "md") {
      const contentBuffer = Buffer.from(markdown, "utf8");
      const storagePath = `${userId}/${sessionId}/${filenameBase}.md`;

      if (hasSupabaseConfig && supabase) {
        const { error: uploadError } = await supabase.storage
          .from(EXPORT_BUCKET)
          .upload(storagePath, contentBuffer, {
            contentType: "text/markdown",
            upsert: true
          });
        if (uploadError) {
          throw new Error(uploadError.message);
        }

        const { data, error: signedUrlError } = await supabase.storage
          .from(EXPORT_BUCKET)
          .createSignedUrl(storagePath, 600);
        if (signedUrlError) {
          throw new Error(signedUrlError.message);
        }

        const record = await store.addExport({
          sessionId,
          format: "md",
          storagePath
        });

        return { export: record, downloadUrl: data?.signedUrl ?? null };
      }

      const record = await store.addExport({
        sessionId,
        format: "md",
        storagePath: storagePath
      });

      return {
        export: record,
        content: markdown,
        filename: `${filenameBase}.md`
      };
    }

    const pdfBuffer = await renderPdfBuffer(
      session.title ?? "Think Tank Session",
      markdown
    );
    const pdfStoragePath = `${userId}/${sessionId}/${filenameBase}.pdf`;

    if (hasSupabaseConfig && supabase) {
      const { error: uploadError } = await supabase.storage
        .from(EXPORT_BUCKET)
        .upload(pdfStoragePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true
        });
      if (uploadError) {
        throw new Error(uploadError.message);
      }

      const { data, error: signedUrlError } = await supabase.storage
        .from(EXPORT_BUCKET)
        .createSignedUrl(pdfStoragePath, 600);
      if (signedUrlError) {
        throw new Error(signedUrlError.message);
      }

      const record = await store.addExport({
        sessionId,
        format: "pdf",
        storagePath: pdfStoragePath
      });

      return { export: record, downloadUrl: data?.signedUrl ?? null };
    }

    const record = await store.addExport({
      sessionId,
      format: "pdf",
      storagePath: pdfStoragePath
    });

    return {
      export: record,
      contentBase64: pdfBuffer.toString("base64"),
      filename: `${filenameBase}.pdf`
    };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

// Derives a short topic title from a council's opening message.
app.post("/api/titles", { config: llmRateLimit }, async (request, reply) => {
  if (!hasOpenAIConfig || !openai) {
    return reply.code(503).send({ error: "openai_not_configured" });
  }

  const parsed = TitleRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
  }

  if (isBlocked(parsed.data.prompt)) {
    return reply.code(400).send({ error: "blocked_prompt" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: openaiModel,
      temperature: 0.3,
      max_tokens: 20,
      messages: [
        {
          role: "system",
          content:
            "You name brainstorming sessions. Reply with a 2 to 5 word title in Title Case that names the topic being discussed, not the request itself. No quotes, no emoji, no trailing punctuation. Examples: \"I want to charge $12 a month for my habit tracker, smart?\" -> Habit Tracker Pricing. \"Give me names for a study app that feels like a co-op game\" -> Co-op Study App Names. \"Should I quit my job to build my startup full time?\" -> Going Full Time on the Startup."
        },
        { role: "user", content: parsed.data.prompt }
      ]
    });

    const title = cleanTitle(completion.choices[0]?.message?.content ?? "");
    if (!title) {
      return reply.code(502).send({ error: "empty_title" });
    }
    return { title };
  } catch (error) {
    logStreamError(error, "title generation failed");
    return reply.code(502).send({ error: getStreamErrorCode(error) });
  }
});

app.patch("/api/sessions/:sessionId", async (request, reply) => {
  const parsed = SessionTitleSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
  }

  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.updateSessionTitle(sessionId, parsed.data.title, userId);
    if (!session) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    return { session };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.post("/api/sessions", async (request, reply) => {
  const parsed = SessionCreateSchema.safeParse(request.body ?? {});

  if (!parsed.success) {
    return reply.code(400).send({
      error: "invalid_request",
      issues: parsed.error.issues
    });
  }

  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.createSession({
      title: parsed.data.title ?? null,
      mode: parsed.data.mode ?? null,
      userId
    });

    return { session };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.get("/api/sessions", async (request, reply) => {
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    return { sessions: await store.listSessions(userId) };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

// Removes every stored file under the council's folder in a bucket. A bucket that doesn't exist holds nothing.
const removeSessionFiles = async (bucket: string, userId: string, sessionId: string) => {
  if (!supabase) return;
  const folder = `${userId}/${sessionId}`;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 100 });
    if (error) {
      if (/not found/i.test(error.message)) return;
      throw new Error(`Couldn't list ${bucket} files: ${error.message}`);
    }
    if (!data || data.length === 0) return;
    const { error: removeError } = await supabase.storage
      .from(bucket)
      .remove(data.map((file) => `${folder}/${file.name}`));
    if (removeError) {
      throw new Error(`Couldn't remove ${bucket} files: ${removeError.message}`);
    }
    if (data.length < 100) return;
  }
};

app.delete("/api/sessions/:sessionId", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);
    if (!session) {
      return reply.code(404).send({ error: "session_not_found" });
    }

    // Files first: if storage fails, the council stays so the delete can be retried without orphaning files.
    if (hasSupabaseConfig && supabase) {
      await removeSessionFiles(STORAGE_BUCKET, userId, sessionId);
      await removeSessionFiles(EXPORT_BUCKET, userId, sessionId);
    }

    const deleted = await store.deleteSession(sessionId, userId);
    if (!deleted) {
      return reply.code(404).send({ error: "session_not_found" });
    }
    return { deleted: true, id: sessionId };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.get("/api/sessions/:sessionId", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    return { session };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.post("/api/sessions/:sessionId/turns", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    const parsed = TurnCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues
      });
    }

    if (isBlocked(parsed.data.content)) {
      return reply.code(400).send({
        error: "blocked_prompt"
      });
    }

    const turn = await store.addTurn({
      sessionId,
      persona: parsed.data.persona,
      role: parsed.data.role ?? null,
      content: parsed.data.content,
      tokens: parsed.data.tokens ?? null
    });

    return { turn };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.get("/api/sessions/:sessionId/turns", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    return { turns: await store.listTurns(sessionId) };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.post("/api/sessions/:sessionId/artifacts", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    const parsed = ArtifactCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues
      });
    }

    const artifact = await store.addArtifact({
      sessionId,
      filename: parsed.data.filename,
      mime: parsed.data.mime,
      size: parsed.data.size
    });

    return { artifact };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.post("/api/sessions/:sessionId/artifacts/upload", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    let fileData;
    try {
      fileData = await request.file();
    } catch (error) {
      const maybeMultipartError = error as { code?: string } | null;
      if (maybeMultipartError?.code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(400).send({ error: "file_too_large" });
      }
      return reply.code(400).send({ error: "invalid_upload" });
    }

    if (!fileData) {
      return reply.code(400).send({ error: "missing_file" });
    }

    const { filename: rawFilename, mimetype, file } = fileData;
    const filename = normalizeUploadedFilename(rawFilename);
    const chunks: Buffer[] = [];

    for await (const chunk of file) {
      chunks.push(chunk as Buffer);
    }

    const buffer = Buffer.concat(chunks);
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      return reply.code(400).send({ error: "file_too_large" });
    }

    const artifactKind = detectArtifactKind(buffer, mimetype, filename);
    if (!artifactKind) {
      return reply.code(415).send({
        error: "unsupported_file_type",
        message: "Only PDF, TXT, and MD files are supported."
      });
    }

    const storageContentType = inferContentType(artifactKind, filename);

    const artifact = await store.addArtifact({
      sessionId,
      filename,
      mime: storageContentType,
      size: buffer.length,
      status: "parsing"
    });

    if (hasSupabaseConfig && supabase) {
      const storagePath = `${userId}/${sessionId}/${artifact.id}-${filename}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: storageContentType,
          upsert: false
        });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
    }

    void (async () => {
      try {
        const parsedText = await parseArtifactBuffer(
          buffer,
          storageContentType,
          filename
        );
        await store.updateArtifact(artifact.id, {
          status: "ready",
          parsedText: limitText(parsedText)
        });
      } catch (error) {
        app.log.error(
          {
            artifactId: artifact.id,
            sessionId,
            filename,
            err: error
          },
          "Artifact parsing failed"
        );
        await store.updateArtifact(artifact.id, {
          status: "failed"
        });
      }
    })();

    return { artifact };
  } catch (error) {
    app.log.error(
      {
        sessionId,
        err: error
      },
      "Artifact upload failed"
    );
    return reply.code(500).send({
      error: "upload_failed"
    });
  }
});

app.get("/api/sessions/:sessionId/artifacts", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    return { artifacts: await store.listArtifacts(sessionId) };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

app.post("/api/sessions/:sessionId/exports", async (request, reply) => {
  return reply.code(410).send({
    error: "deprecated_endpoint",
    message: "Use /api/sessions/:sessionId/exports/generate"
  });
});

app.get("/api/sessions/:sessionId/exports", async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = await requireUserId(request, reply);
  if (!userId) {
    return;
  }

  try {
    const session = await store.getSession(sessionId, userId);

    if (!session) {
      return reply.code(404).send({
        error: "session_not_found"
      });
    }

    return { exports: await store.listExports(sessionId) };
  } catch (error) {
    handleStoreError(reply, error);
  }
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    if (!hasOpenAIConfig) {
      app.log.warn(
        "LLM provider is not configured. Streaming endpoints will return openai_not_configured until OPENAI_API_KEY or OPENROUTER_API_KEY is set."
      );
    }
    if (!hasSupabaseConfig) {
      app.log.warn("Supabase is not configured. Using in-memory store.");
    }
    app.log.info(
      {
        llmProvider: openaiProvider,
        llmModel: openaiModel,
        llmBaseUrl: openaiBaseUrl,
        llmConfigured: hasOpenAIConfig,
        persistence: hasSupabaseConfig ? "supabase" : "memory",
        allowMemoryStore
      },
      "LLM provider configuration loaded"
    );
    await app.listen({ port, host: process.env.HOST?.trim() || "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

// Hosts send SIGTERM before replacing an instance: stop taking requests, let in-flight ones
// finish, and give up after a grace period so a long stream can't block the deploy.
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  const timer = setTimeout(() => {
    app.log.warn("graceful shutdown timed out; exiting");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  timer.unref();
  app
    .close()
    .then(() => process.exit(0))
    .catch((error) => {
      app.log.error({ err: error }, "error during shutdown");
      process.exit(1);
    });
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

start();
