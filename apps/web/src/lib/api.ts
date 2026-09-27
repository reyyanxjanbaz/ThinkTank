import type { Persona, Session, Turn } from "./types";
type Artifact = {
  id: string;
  sessionId: string;
  filename: string;
  mime: string;
  size: number;
  status: "uploaded" | "parsing" | "ready" | "failed";
  parsedText: string | null;
  createdAt: string;
};

const configuredApiUrl = (
  import.meta.env.VITE_API_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

let resolvedApiBase: string | null = null;
let resolvingApiBase: Promise<string> | null = null;

const LOOPBACK_API_URLS = [
  "http://127.0.0.1:3001",
  "http://localhost:3001",
  "http://[::1]:3001"
];

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const formatApiBase = (apiBase: string) => apiBase || "same-origin";

const getApiUrls = () => {
  const urls = ["", configuredApiUrl, ...LOOPBACK_API_URLS];

  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location;
    if (hostname && !isLoopbackHost(hostname)) {
      urls.push(`${protocol}//${hostname}:3001`);
      urls.push(`http://${hostname}:3001`);
      urls.push(`https://${hostname}:3001`);
    }
  }

  return Array.from(
    new Set(
      urls.filter(
        (value): value is string => value !== undefined && value !== null
      )
    )
  );
};

const probeApiBase = async (apiUrl: string) => {
  const response = await fetch(`${apiUrl}/health`, {
    method: "GET"
  });

  if (!response.ok) {
    throw new Error(`Health check failed (${response.status}) for ${apiUrl || "same-origin"}`);
  }

  let payload: { status?: string } | null = null;
  try {
    payload = (await response.json()) as { status?: string };
  } catch {
    throw new Error(`Health response was not JSON for ${apiUrl || "same-origin"}`);
  }

  if (payload.status !== "ok") {
    throw new Error(`Health response missing status=ok for ${apiUrl || "same-origin"}`);
  }

  return apiUrl;
};

const isRetriableStatus = (status: number) =>
  status === 404 || status === 502 || status === 503 || status === 504;

const resolveApiBase = async () => {
  if (resolvedApiBase !== null) {
    return resolvedApiBase;
  }

  if (!resolvingApiBase) {
    resolvingApiBase = (async () => {
      const attempts: Array<{ base: string; error: string }> = [];

      for (const apiUrl of getApiUrls()) {
        try {
          const healthyBase = await probeApiBase(apiUrl);
          resolvedApiBase = healthyBase;
          return healthyBase;
        } catch (error) {
          attempts.push({
            base: formatApiBase(apiUrl),
            error: toErrorMessage(error)
          });
        }
      }

      const detail = attempts
        .map((attempt) => `${attempt.base} -> ${attempt.error}`)
        .join(" | ");
      throw new Error(`API base resolution failed. ${detail}`);
    })().finally(() => {
      resolvingApiBase = null;
    });
  }

  return resolvingApiBase;
};

const fetchFromApi = async (path: string, options?: RequestInit) => {
  const makeRequest = async () => {
    const apiBase = await resolveApiBase();
    return fetch(`${apiBase}${path}`, options);
  };

  try {
    const response = await makeRequest();
    if (isRetriableStatus(response.status)) {
      resolvedApiBase = null;
      return makeRequest();
    }
    return response;
  } catch (error) {
    resolvedApiBase = null;
    return makeRequest();
  }
};

type StreamHandlers = {
  onToken?: (token: string, fullText: string) => void;
  onDone?: (fullText: string) => void;
};

const request = async <T>(
  path: string,
  options?: RequestInit,
  accessToken?: string
): Promise<T> => {
  const headers = {
    "Content-Type": "application/json",
    ...(options?.headers ?? {})
  } as Record<string, string>;

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetchFromApi(path, {
    ...options,
    headers
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
};

export const getPersonas = (accessToken?: string) =>
  request<{ personas: Persona[] }>("/api/personas", undefined, accessToken);

export const validatePrompt = (payload: {
  sessionId?: string;
  persona: string;
  prompt: string;
}, accessToken?: string) =>
  request<{ ok: boolean }>(
    "/api/validate-prompt",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );

export const createSession = (
  payload: { title?: string; mode?: string },
  accessToken?: string
) =>
  request<{ session: Session }>(
    "/api/sessions",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );

export const generateTitle = (prompt: string, accessToken?: string) =>
  request<{ title: string }>(
    "/api/titles",
    { method: "POST", body: JSON.stringify({ prompt }) },
    accessToken
  );

export const renameSession = (sessionId: string, title: string, accessToken?: string) =>
  request<{ session: Session }>(
    `/api/sessions/${sessionId}`,
    { method: "PATCH", body: JSON.stringify({ title }) },
    accessToken
  );

export const listSessions = (accessToken?: string) =>
  request<{ sessions: Session[] }>("/api/sessions", undefined, accessToken);

export const createTurn = (
  sessionId: string,
  payload: {
    persona: string;
    role?: string;
    content: string;
    tokens?: number;
  },
  accessToken?: string
) =>
  request<{ turn: Turn }>(
    `/api/sessions/${sessionId}/turns`,
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    accessToken
  );

export const listTurns = (sessionId: string, accessToken?: string) =>
  request<{ turns: Turn[] }>(
    `/api/sessions/${sessionId}/turns`,
    undefined,
    accessToken
  );

export const uploadArtifact = async (
  sessionId: string,
  file: File,
  accessToken?: string
) => {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const headers: Record<string, string> = {};
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetchFromApi(
    `/api/sessions/${sessionId}/artifacts/upload`,
    {
      method: "POST",
      headers,
      body: formData
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    let detail = errorBody;
    try {
      const parsed = JSON.parse(errorBody) as { error?: string; message?: string };
      detail = parsed.message ?? parsed.error ?? errorBody;
    } catch {
      // keep raw error body
    }
    throw new Error(`Upload failed (${response.status}): ${detail}`);
  }

  return response.json() as Promise<{ artifact: Artifact }>;
};

export const listArtifacts = (sessionId: string, accessToken?: string) =>
  request<{ artifacts: Artifact[] }>(
    `/api/sessions/${sessionId}/artifacts`,
    undefined,
    accessToken
  );

const readTokenStream = async (response: Response, handlers?: StreamHandlers) => {
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Stream failed (${response.status}): ${errorBody}`);
  }

  if (!response.body) {
    throw new Error("Stream body missing");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const handleData = (data: string) => {
    if (!data) {
      return;
    }
    if (data === "[DONE]") {
      return;
    }

    let token = data;
    let parsed: { token?: string; error?: string } | null = null;
    try {
      parsed = JSON.parse(data) as { token?: string; error?: string };
    } catch {
      parsed = null;
    }

    if (parsed) {
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (typeof parsed.token === "string") {
        token = parsed.token;
      } else {
        return;
      }
    }

    fullText += token;
    handlers?.onToken?.(token, fullText);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data:"));
      if (!line) {
        continue;
      }
      const data = line.replace(/^data:\s?/, "").trim();
      handleData(data);
    }
  }

  if (buffer.trim()) {
    const line = buffer.split("\n").find((item) => item.startsWith("data:"));
    if (line) {
      const data = line.replace(/^data:\s?/, "").trim();
      handleData(data);
    }
  }

  handlers?.onDone?.(fullText);
  return fullText;
};

export const streamPersonaResponse = async (
  sessionId: string,
  payload: {
    persona: string;
    prompt: string;
    mode?: string;
    followUp?: boolean;
  },
  accessToken?: string,
  handlers?: StreamHandlers
) => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetchFromApi(`/api/sessions/${sessionId}/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });

  return readTokenStream(response, handlers);
};

export const streamGuestPersonaResponse = async (
  payload: {
    persona: string;
    prompt: string;
    mode?: string;
    followUp?: boolean;
    history?: Array<{ speaker: string; content: string }>;
  },
  handlers?: StreamHandlers
) => {
  const response = await fetchFromApi("/api/guest/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  return readTokenStream(response, handlers);
};

export const generateExport = (
  sessionId: string,
  format: "md" | "pdf",
  accessToken?: string
) =>
  request<{
    export: { id: string; format: "md" | "pdf"; storagePath: string };
    downloadUrl?: string | null;
    content?: string;
    contentBase64?: string;
    filename?: string;
  }>(
    `/api/sessions/${sessionId}/exports/generate`,
    {
      method: "POST",
      body: JSON.stringify({ format })
    },
    accessToken
  );
