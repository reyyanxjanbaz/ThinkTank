import "./lib/env.js";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { PERSONA_NAMES, getPublicPersonas } from "./prompts/personas.js";
import {
  buildContextPrompt,
  buildPrompt,
  buildSystemPrompt,
  type PromptHistoryItem
} from "./prompts/buildPrompt.js";
import { parseArtifactBuffer, limitText } from "./lib/artifactParser.js";
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

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

const MAX_ARTIFACT_BYTES = (() => {
  const parsed = Number.parseInt(process.env.MAX_ARTIFACT_SIZE ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5 * 1024 * 1024;
})();

const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "artifacts";
const EXPORT_BUCKET = process.env.SUPABASE_EXPORT_BUCKET ?? "exports";

await app.register(multipart, {
  limits: {
    fileSize: MAX_ARTIFACT_BYTES
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
  prompt: z.string().min(1).max(4000)
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
  if (error instanceof Error) {
    console.error(error.message);
  }
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

app.get("/health", async () => ({
  status: "ok",
  time: new Date().toISOString()
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

app.post("/api/guest/stream", async (request, reply) => {
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
  const contextPrompt = buildContextPrompt({
    history: history as PromptHistoryItem[],
    userPrompt: parsed.data.prompt
  });

  let onClose: (() => void) | null = null;

  try {
    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();

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

app.post("/api/sessions/:sessionId/stream", async (request, reply) => {
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
      userPrompt: parsed.data.prompt
    });
    await store.addTurn({
      sessionId,
      persona: "User",
      content: parsed.data.prompt
    });

    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.flushHeaders?.();

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
      return reply.code(400).send({ error: "invalid_upload" });
    }

    if (!fileData) {
      return reply.code(400).send({ error: "missing_file" });
    }

    const { filename, mimetype, file } = fileData;
    const chunks: Buffer[] = [];

    for await (const chunk of file) {
      chunks.push(chunk as Buffer);
    }

    const buffer = Buffer.concat(chunks);
    if (buffer.length > MAX_ARTIFACT_BYTES) {
      return reply.code(400).send({ error: "file_too_large" });
    }

    const artifact = await store.addArtifact({
      sessionId,
      filename,
      mime: mimetype,
      size: buffer.length,
      status: "parsing"
    });

    if (hasSupabaseConfig && supabase) {
      const storagePath = `${userId}/${sessionId}/${artifact.id}-${filename}`;
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, buffer, {
          contentType: mimetype,
          upsert: false
        });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
    }

    void (async () => {
      try {
        const parsedText = await parseArtifactBuffer(buffer, mimetype);
        await store.updateArtifact(artifact.id, {
          status: "ready",
          parsedText: limitText(parsedText)
        });
      } catch (error) {
        await store.updateArtifact(artifact.id, {
          status: "failed"
        });
      }
    })();

    return { artifact };
  } catch (error) {
    handleStoreError(reply, error);
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
    app.log.info(
      {
        llmProvider: openaiProvider,
        llmModel: openaiModel,
        llmBaseUrl: openaiBaseUrl,
        llmConfigured: hasOpenAIConfig
      },
      "LLM provider configuration loaded"
    );
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
