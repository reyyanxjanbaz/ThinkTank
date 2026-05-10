import { useEffect, useMemo, useState } from "react";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import type { Persona, Session } from "./lib/types";
import {
  createSession,
  getPersonas,
  generateExport,
  listSessions,
  listTurns,
  streamGuestPersonaResponse,
  streamPersonaResponse,
  uploadArtifact,
  validatePrompt
} from "./lib/api";
import { hasSupabaseConfig, supabase } from "./lib/supabaseClient";

const MODES = [
  {
    name: "Brainstorm",
    description: "A wide-open idea forge. The council expands, mutates, remixes, and finds unexpected paths.",
    intent: "Use when you need volume, novelty, naming, positioning, or a bigger frame.",
    ritual: "Open loops, high imagination, low judgement."
  },
  {
    name: "Shark Tank",
    description: "A pressure chamber for business logic. The council interrogates market, moat, user pain, and proof.",
    intent: "Use before pitching, pricing, fundraising, or deciding if an idea deserves oxygen.",
    ritual: "Defend the weak spots or cut them."
  },
  {
    name: "Devils Court",
    description: "A hostile audit where every persona hunts contradictions, failure modes, and hidden costs.",
    intent: "Use when you are attached to an idea and need the room to be intellectually honest.",
    ritual: "No politeness tax. Only useful pressure."
  },
  {
    name: "Co-Founder",
    description: "A focused build session with strategic disagreement, practical next steps, and founder-level synthesis.",
    intent: "Use when you already care about the idea and need a path from thought to execution.",
    ritual: "Ship the next clean decision."
  }
];

const FALLBACK_PERSONAS: Persona[] = [
  {
    name: "Devil",
    role: "Adversary",
    tagline: "Relentless stress test.",
    focus: "Assumptions, contradictions, failure modes."
  },
  {
    name: "Tyson",
    role: "Visionary",
    tagline: "Pushes bold futures.",
    focus: "Scale, virality, imagination, upside."
  },
  {
    name: "Bison",
    role: "Operator",
    tagline: "Reality check and execution.",
    focus: "Feasibility, scope, timeline, constraints."
  },
  {
    name: "Anshu",
    role: "Strategist",
    tagline: "Founder-level wisdom.",
    focus: "Strategy, leadership, human factors."
  },
  {
    name: "Bucks",
    role: "Monetizer",
    tagline: "Revenue and growth leverage.",
    focus: "Pricing, distribution, monetization loops."
  }
];

const PERSONA_META: Record<
  string,
  {
    archetype: string;
    species: string;
    signal: string;
    stat: string;
    quote: string;
  }
> = {
  Devil: {
    archetype: "The Ruin Tester",
    species: "Horned devil advocate",
    signal: "Find the contradiction before the market does.",
    stat: "Brutality 96",
    quote: "If it survives me, it might survive reality."
  },
  Tyson: {
    archetype: "The Cultural Igniter",
    species: "Tiger in a hoodie",
    signal: "Make the idea louder, stranger, and more contagious.",
    stat: "Momentum 91",
    quote: "Small ideas are just big ideas wearing fear."
  },
  Bison: {
    archetype: "The Ground Commander",
    species: "Centaur operator",
    signal: "Turn the fantasy into a sequence people can execute.",
    stat: "Feasibility 94",
    quote: "Show me the path, the cost, and the first version."
  },
  Bucks: {
    archetype: "The Money Gremlin",
    species: "Blinged-out monkey",
    signal: "Spot loops, margins, premium behavior, and hidden leverage.",
    stat: "Upside 89",
    quote: "If value moves, money can move with it."
  },
  Anshu: {
    archetype: "The Calm Apex",
    species: "Saint fox",
    signal: "Balance ambition with timing, people, and judgment.",
    stat: "Wisdom 98",
    quote: "A good decision makes the founder lighter."
  }
};

type FeedItem = {
  id: string;
  speaker: string;
  content: string;
  time: string;
};

type Page = "home" | "war-room" | "personas" | "modes" | "vault" | "guide";

type PixelBlock = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  fill: string;
};

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

const NAV_ITEMS: Array<{ page: Page; label: string; helper: string }> = [
  { page: "home", label: "Home", helper: "Briefing" },
  { page: "war-room", label: "War Room", helper: "Live session" },
  { page: "personas", label: "Personas", helper: "Build squad" },
  { page: "modes", label: "Modes", helper: "Set pressure" },
  { page: "vault", label: "Vault", helper: "Reload work" },
  { page: "guide", label: "Guide", helper: "How it flows" }
];

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const makeLocalSession = (mode: string): Session => {
  const timestamp = new Date().toISOString();
  return {
    id: `local-${makeId()}`,
    title: "Untitled Council (Local)",
    mode,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  };
};

const formatClock = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });

const formatTurnTime = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const downloadTextFile = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const downloadBase64File = (
  filename: string,
  base64: string,
  mime: string
) => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

const normalizePersonaText = (value: string) =>
  value
    .replace(/\r/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

const renderBlocks = (blocks: PixelBlock[]) =>
  blocks.map((block, index) => (
    <rect
      key={`${block.fill}-${block.x}-${block.y}-${index}`}
      x={block.x}
      y={block.y}
      width={block.w ?? 4}
      height={block.h ?? 4}
      fill={block.fill}
    />
  ));

function PixelAvatar({ name, compact = false }: { name: string; compact?: boolean }) {
  const baseBlocks: PixelBlock[] = [
    { x: 6, y: 54, w: 52, h: 4, fill: "#23170d" },
    { x: 10, y: 58, w: 44, h: 2, fill: "#0b0906" }
  ];

  const avatarBlocks: Record<string, PixelBlock[]> = {
    Devil: [
      { x: 16, y: 10, w: 8, h: 8, fill: "#ff4b35" },
      { x: 40, y: 10, w: 8, h: 8, fill: "#ff4b35" },
      { x: 20, y: 16, w: 24, h: 4, fill: "#9e1f1a" },
      { x: 14, y: 20, w: 36, h: 28, fill: "#d52f25" },
      { x: 18, y: 24, w: 28, h: 20, fill: "#ff6b45" },
      { x: 20, y: 30, w: 8, h: 4, fill: "#0b0906" },
      { x: 36, y: 30, w: 8, h: 4, fill: "#0b0906" },
      { x: 28, y: 38, w: 8, h: 4, fill: "#fff1d1" },
      { x: 20, y: 48, w: 24, h: 8, fill: "#44100f" }
    ],
    Tyson: [
      { x: 18, y: 10, w: 8, h: 8, fill: "#ff9a2f" },
      { x: 38, y: 10, w: 8, h: 8, fill: "#ff9a2f" },
      { x: 14, y: 18, w: 36, h: 30, fill: "#f07c22" },
      { x: 20, y: 20, w: 24, h: 24, fill: "#ffb04f" },
      { x: 18, y: 26, w: 8, h: 4, fill: "#1a1208" },
      { x: 38, y: 26, w: 8, h: 4, fill: "#1a1208" },
      { x: 28, y: 34, w: 8, h: 4, fill: "#fff1d1" },
      { x: 14, y: 46, w: 36, h: 10, fill: "#2f5d48" },
      { x: 20, y: 46, w: 24, h: 4, fill: "#17392d" },
      { x: 12, y: 22, w: 4, h: 8, fill: "#1a1208" },
      { x: 48, y: 22, w: 4, h: 8, fill: "#1a1208" }
    ],
    Bison: [
      { x: 10, y: 34, w: 34, h: 14, fill: "#6c4427" },
      { x: 40, y: 38, w: 10, h: 8, fill: "#8b5a32" },
      { x: 12, y: 48, w: 6, h: 10, fill: "#2a1c12" },
      { x: 36, y: 48, w: 6, h: 10, fill: "#2a1c12" },
      { x: 44, y: 46, w: 4, h: 10, fill: "#2a1c12" },
      { x: 22, y: 14, w: 20, h: 18, fill: "#9b6a3d" },
      { x: 18, y: 20, w: 28, h: 8, fill: "#4b2c19" },
      { x: 16, y: 10, w: 8, h: 8, fill: "#fff1d1" },
      { x: 40, y: 10, w: 8, h: 8, fill: "#fff1d1" },
      { x: 26, y: 20, w: 4, h: 4, fill: "#0b0906" },
      { x: 36, y: 20, w: 4, h: 4, fill: "#0b0906" },
      { x: 26, y: 28, w: 14, h: 6, fill: "#26372c" }
    ],
    Bucks: [
      { x: 16, y: 16, w: 32, h: 30, fill: "#8b5731" },
      { x: 10, y: 22, w: 8, h: 12, fill: "#6f3d22" },
      { x: 46, y: 22, w: 8, h: 12, fill: "#6f3d22" },
      { x: 22, y: 24, w: 20, h: 16, fill: "#c88752" },
      { x: 22, y: 28, w: 6, h: 4, fill: "#0b0906" },
      { x: 36, y: 28, w: 6, h: 4, fill: "#0b0906" },
      { x: 26, y: 38, w: 12, h: 4, fill: "#fff1d1" },
      { x: 18, y: 12, w: 28, h: 4, fill: "#ffd15c" },
      { x: 24, y: 46, w: 16, h: 4, fill: "#ffd15c" },
      { x: 20, y: 50, w: 24, h: 6, fill: "#e6532f" },
      { x: 46, y: 44, w: 8, h: 8, fill: "#ffd15c" }
    ],
    Anshu: [
      { x: 20, y: 6, w: 24, h: 4, fill: "#ffd15c" },
      { x: 16, y: 10, w: 32, h: 4, fill: "#fff1d1" },
      { x: 16, y: 20, w: 32, h: 26, fill: "#d87739" },
      { x: 12, y: 16, w: 10, h: 12, fill: "#d87739" },
      { x: 42, y: 16, w: 10, h: 12, fill: "#d87739" },
      { x: 22, y: 24, w: 20, h: 16, fill: "#fff1d1" },
      { x: 22, y: 30, w: 4, h: 4, fill: "#0b0906" },
      { x: 38, y: 30, w: 4, h: 4, fill: "#0b0906" },
      { x: 28, y: 38, w: 8, h: 4, fill: "#d87739" },
      { x: 20, y: 46, w: 24, h: 10, fill: "#f8f0cf" },
      { x: 16, y: 50, w: 32, h: 4, fill: "#8df7c4" }
    ]
  };

  const blocks = [...baseBlocks, ...(avatarBlocks[name] ?? avatarBlocks.Devil)];

  return (
    <div className={compact ? "avatar-shell avatar-shell-compact" : "avatar-shell"}>
      <svg
        className="pixel-avatar"
        viewBox="0 0 64 64"
        role="img"
        aria-label={`${name} pixel avatar`}
        shapeRendering="crispEdges"
      >
        <rect x="0" y="0" width="64" height="64" fill="#13150c" />
        <rect x="4" y="4" width="56" height="56" fill="#20291c" />
        <rect x="4" y="4" width="56" height="4" fill="#3e573b" />
        {renderBlocks(blocks)}
      </svg>
    </div>
  );
}

function PageKicker({ label, value }: { label: string; value?: string }) {
  return (
    <div className="page-kicker">
      <span className="status-light" />
      <span>{label}</span>
      {value && <strong>{value}</strong>}
    </div>
  );
}

export default function App() {
  const requiresAuth = hasSupabaseConfig;
  const [personas, setPersonas] = useState<Persona[]>(FALLBACK_PERSONAS);
  const [personaStatus, setPersonaStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [authSession, setAuthSession] = useState<SupabaseSession | null>(null);
  const [isAuthInitializing, setIsAuthInitializing] = useState(requiresAuth);
  const [authMessage, setAuthMessage] = useState("");
  const [emailSignIn, setEmailSignIn] = useState("");
  const [isEmailSignInLoading, setIsEmailSignInLoading] = useState(false);
  const [mode, setMode] = useState(MODES[0].name);
  const [activePage, setActivePage] = useState<Page>("home");
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>([
    "Devil",
    "Tyson"
  ]);
  const [activePersona, setActivePersona] = useState("Devil");
  const [prompt, setPrompt] = useState("");
  const [artifactFile, setArtifactFile] = useState<File | null>(null);
  const [artifactStatus, setArtifactStatus] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("Council idle.");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const accessToken = authSession?.access_token ?? "";

  const refreshSessions = async (tokenOverride?: string) => {
    const token = tokenOverride ?? accessToken;

    if (requiresAuth && !token) {
      setSessions([]);
      return;
    }

    setSessionsStatus("Loading sessions...");
    try {
      const data = await listSessions(token);
      setSessions(data.sessions);
      setSessionsStatus("");
    } catch (error) {
      setSessions([]);
      setSessionsStatus("Unable to load sessions.");
    }
  };

  useEffect(() => {
    if (!supabase) {
      setIsAuthInitializing(false);
      return;
    }

    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setAuthSession(data.session ?? null);
      })
      .finally(() => {
        if (!active) return;
        setIsAuthInitializing(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, sessionData) => {
      if (!active) return;
      setAuthSession(sessionData ?? null);
      setIsAuthInitializing(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signInAnonymouslyIfNeeded = async () => {
    if (!requiresAuth || accessToken) {
      return accessToken;
    }
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error || !data.session?.access_token) {
      return null;
    }

    setAuthSession(data.session);
    setAuthMessage("Guest session active for this device.");
    return data.session.access_token;
  };

  useEffect(() => {
    let active = true;
    setPersonaStatus("loading");

    getPersonas(accessToken)
      .then((data) => {
        if (!active) return;
        setPersonas(data.personas);
        setPersonaStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setPersonas(FALLBACK_PERSONAS);
        setPersonaStatus("error");
      });

    return () => {
      active = false;
    };
  }, [accessToken]);

  useEffect(() => {
    let active = true;
    if (!active) return;
    void refreshSessions();
    return () => {
      active = false;
    };
  }, [accessToken, requiresAuth]);

  useEffect(() => {
    if (selectedPersonas.length === 0) {
      setSelectedPersonas([personas[0]?.name ?? "Devil"]);
    }

    if (!selectedPersonas.includes(activePersona)) {
      setActivePersona(selectedPersonas[0] ?? personas[0]?.name ?? "Devil");
    }
  }, [selectedPersonas, personas, activePersona]);

  const personaLookup = useMemo(() => {
    const map = new Map(personas.map((persona) => [persona.name, persona]));
    return map;
  }, [personas]);

  const selectedPersonaObjects = useMemo(
    () =>
      selectedPersonas.map(
        (name) => personaLookup.get(name) ?? FALLBACK_PERSONAS.find((item) => item.name === name)
      ).filter((persona): persona is Persona => Boolean(persona)),
    [personaLookup, selectedPersonas]
  );

  const activeMode = MODES.find((item) => item.name === mode) ?? MODES[0];
  const activePersonaData = personaLookup.get(activePersona);

  const togglePersona = (name: string) => {
    setSelectedPersonas((prev) => {
      if (prev.includes(name)) {
        if (prev.length === 1) return prev;
        return prev.filter((persona) => persona !== name);
      }
      return [...prev, name];
    });
  };

  const goToPage = (page: Page) => {
    setActivePage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSignIn = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    setAuthMessage("Redirecting to GitHub...");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github"
    });

    if (error) {
      setAuthMessage("Sign-in failed. Check Supabase settings.");
    }
  };

  const handleEmailSignIn = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    const email = emailSignIn.trim();
    if (!email) {
      setAuthMessage("Enter an email address first.");
      return;
    }

    setIsEmailSignInLoading(true);
    setAuthMessage("Sending email sign-in link...");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href
      }
    });

    if (error) {
      setAuthMessage("Email sign-in failed. Check Supabase email auth settings.");
      setIsEmailSignInLoading(false);
      return;
    }

    setAuthMessage("Magic link sent. Check your email inbox.");
    setEmailSignIn("");
    setIsEmailSignInLoading(false);
  };

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setAuthMessage("Signed out.");
  };

  const handleUpload = async () => {
    if (!session) {
      setArtifactStatus("Launch a session before uploading.");
      return;
    }

    if (!artifactFile) {
      setArtifactStatus("Choose a file to upload.");
      return;
    }

    if (artifactFile.size > MAX_ARTIFACT_BYTES) {
      setArtifactStatus("File too large. Max 5MB.");
      return;
    }

    if (requiresAuth && !accessToken) {
      setArtifactStatus("Sign in before uploading artifacts.");
      return;
    }

    setArtifactStatus("Uploading artifact...");

    try {
      const response = await uploadArtifact(session.id, artifactFile, accessToken);
      setArtifactStatus(`Uploaded. Parsing in progress (id: ${response.artifact.id}).`);
      setArtifactFile(null);
    } catch (error) {
      setArtifactStatus("Upload failed. Check API + Supabase storage.");
    }
  };

  const handleLaunch = async () => {
    if (isLaunching) return;

    if (requiresAuth && isAuthInitializing) {
      setStatusMessage("Checking sign-in state. Try again in a moment.");
      return;
    }

    setIsLaunching(true);
    setStatusMessage("Initializing council...");

    const setStartedState = (nextSession: Session, message: string) => {
      setSession(nextSession);
      setFeed([]);
      setArtifactStatus("");
      setExportStatus("");
      setStatusMessage(message);
      setActivePage("war-room");
    };

    try {
      let effectiveToken = accessToken;
      if (requiresAuth && !effectiveToken) {
        effectiveToken = (await signInAnonymouslyIfNeeded()) ?? "";
      }

      if (requiresAuth && !effectiveToken) {
        const localSession = makeLocalSession(mode);
        setStartedState(
          localSession,
          "Local draft session started. Enable anonymous auth or sign in for cloud conversation."
        );
        return;
      }

      const response = await createSession(
        {
          title: "Untitled Council",
          mode
        },
        effectiveToken
      );
      setStartedState(response.session, "Council online.");
      await refreshSessions(effectiveToken);
    } catch (error) {
      const localSession = makeLocalSession(mode);
      setStartedState(
        localSession,
        "API launch failed. Local draft session started for now."
      );
    } finally {
      setIsLaunching(false);
    }
  };

  const handleLoadSession = async (target: Session) => {
    if (requiresAuth && !accessToken) {
      setSessionsStatus("Sign in to load saved sessions.");
      return;
    }

    setSession(target);
    setMode(target.mode ?? mode);
    setStatusMessage("Loading transcript...");
    setFeed([]);
    setActivePage("war-room");

    try {
      const data = await listTurns(target.id, accessToken);
      const loadedFeed = data.turns.map((turn) => ({
        id: turn.id,
        speaker: turn.persona,
        content: turn.content,
        time: formatTurnTime(turn.createdAt)
      }));
      setFeed(loadedFeed);
      setStatusMessage("Session loaded.");
    } catch (error) {
      setFeed([]);
      setStatusMessage("Failed to load session transcript.");
    }
  };

  const handleExport = async (format: "md" | "pdf") => {
    if (!session) {
      setExportStatus("Launch a session to export.");
      return;
    }

    if (requiresAuth && !accessToken) {
      setExportStatus("Sign in before exporting.");
      return;
    }

    setIsExporting(true);
    setExportStatus(`Generating ${format.toUpperCase()} export...`);

    try {
      const response = await generateExport(session.id, format, accessToken);
      if (response.downloadUrl) {
        window.open(response.downloadUrl, "_blank");
        setExportStatus("Export ready. Download opened.");
      } else if (response.content && response.filename) {
        downloadTextFile(response.filename, response.content, "text/markdown");
        setExportStatus("Markdown export downloaded.");
      } else if (response.contentBase64 && response.filename) {
        downloadBase64File(
          response.filename,
          response.contentBase64,
          "application/pdf"
        );
        setExportStatus("PDF export downloaded.");
      } else {
        setExportStatus("Export generated, but no download payload.");
      }
    } catch (error) {
      setExportStatus("Export failed. Check API + storage.");
    } finally {
      setIsExporting(false);
    }
  };

  const getStreamFailureMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("Load failed")
    ) {
      return "API server is unreachable. Start apps/api with npm run dev and confirm VITE_API_URL points to http://localhost:3001.";
    }
    if (message.includes("openai_not_configured")) {
      return "LLM provider is not configured. Add OPENROUTER_API_KEY or OPENAI_API_KEY to apps/api/.env, then restart the API.";
    }
    if (message.includes("openai_auth_failed")) {
      return "LLM provider rejected the API key. Replace OPENROUTER_API_KEY or OPENAI_API_KEY in apps/api/.env, then restart the API.";
    }
    if (message.includes("openai_payment_required")) {
      return "Provider credits required. Add credits to your OpenRouter/OpenAI account.";
    }
    if (message.includes("openai_forbidden")) {
      return "Provider denied this request. Verify model access and key permissions.";
    }
    if (message.includes("openai_rate_limited")) {
      return "Provider rate limit hit. Wait or use a different model/key.";
    }
    if (message.includes("invalid_request")) {
      return "The stream request was invalid. Check persona, mode, and prompt length.";
    }
    return `Streaming failed. ${message || "Check API and LLM provider config."}`;
  };

  const writeStreamFailureToFeed = (responseId: string, error: unknown) => {
    const failureMessage = getStreamFailureMessage(error);
    setStatusMessage(failureMessage);
    setFeed((prev) =>
      prev.map((item) =>
        item.id === responseId
          ? {
              ...item,
              content: failureMessage
            }
          : item
      )
    );
  };

  const handleSend = async () => {
    if (!session) {
      setStatusMessage("Launch a session before sending prompts.");
      setActivePage("war-room");
      return;
    }

    const trimmed = prompt.trim();
    if (!trimmed) {
      setStatusMessage("Enter a prompt to continue.");
      return;
    }

    if (isSending) return;
    setIsSending(true);

    let activeSession = session;
    let effectiveToken = accessToken;

    if (requiresAuth && !effectiveToken) {
      effectiveToken = (await signInAnonymouslyIfNeeded()) ?? "";
    }

    if (activeSession.id.startsWith("local-") && (!requiresAuth || Boolean(effectiveToken))) {
      try {
        const response = await createSession(
          {
            title: activeSession.title ?? "Untitled Council",
            mode: activeSession.mode ?? mode
          },
          effectiveToken
        );
        activeSession = response.session;
        setSession(response.session);
        await refreshSessions(effectiveToken);
      } catch {
        // stay in local draft mode if cloud bootstrap fails
      }
    }

    const useCloudStreaming =
      !activeSession.id.startsWith("local-") && (!requiresAuth || Boolean(effectiveToken));

    const userEntry: FeedItem = {
      id: makeId(),
      speaker: "User",
      content: trimmed,
      time: formatClock()
    };

    const responseId = makeId();
    const personaEntry: FeedItem = {
      id: responseId,
      speaker: activePersona,
      content: "",
      time: formatClock()
    };

    const promptHistory = feed
      .filter((item) => item.content.trim())
      .slice(-12)
      .map((item) => ({
        speaker:
          item.speaker === "User" || personaLookup.has(item.speaker)
            ? item.speaker
            : "User",
        content: item.content
      }));

    const appendToken = (token: string) => {
      setFeed((prev) =>
        prev.map((item) =>
          item.id === responseId
            ? { ...item, content: `${item.content}${token}` }
            : item
        )
      );
    };

    const streamGuestResponse = async () =>
      streamGuestPersonaResponse(
        {
          persona: activePersona,
          prompt: trimmed,
          mode,
          history: promptHistory
        },
        {
          onToken: appendToken,
          onDone: (fullText) => {
            setStatusMessage(
              fullText.trim()
                ? `${activePersona} completed the response.`
                : "Guest stream finished without content."
            );
          }
        }
      );

    if (!useCloudStreaming) {
      setFeed((prev) => [...prev, userEntry, personaEntry]);
      setPrompt("");
      setStatusMessage(`Streaming ${activePersona} in guest mode...`);
      try {
        await streamGuestResponse();
      } catch (error) {
        writeStreamFailureToFeed(responseId, error);
      } finally {
        setIsSending(false);
      }
      return;
    }

    try {
      await validatePrompt(
        {
          sessionId: activeSession.id,
          persona: activePersona,
          prompt: trimmed
        },
        effectiveToken
      );
    } catch (error) {
      setStatusMessage("Prompt blocked or API unavailable.");
      setIsSending(false);
      return;
    }

    setFeed((prev) => [...prev, userEntry, personaEntry]);
    setPrompt("");
    setStatusMessage(`Streaming ${activePersona}...`);

    try {
      await streamPersonaResponse(
        activeSession.id,
        {
          persona: activePersona,
          prompt: trimmed,
          mode
        },
        effectiveToken,
        {
          onToken: (token) => {
            appendToken(token);
          },
          onDone: (fullText) => {
            setStatusMessage(
              fullText.trim()
                ? `${activePersona} completed the response.`
                : "Stream finished without content."
            );
          }
        }
      );
    } catch (error) {
      setStatusMessage("Cloud streaming failed; retrying in guest mode...");
      setFeed((prev) =>
        prev.map((item) => (item.id === responseId ? { ...item, content: "" } : item))
      );
      try {
        await streamGuestResponse();
      } catch (guestError) {
        writeStreamFailureToFeed(responseId, guestError);
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleStartQuest = async () => {
    if (!session) {
      await handleLaunch();
      return;
    }
    goToPage("war-room");
  };

  const handleWatchDemo = () => {
    setStatusMessage("Demo path: choose mode, assemble personas, launch the room, then send one sharp prompt.");
    goToPage("guide");
  };

  const renderHome = () => (
    <main className="app-page home-grid">
      <section className="hero-copy">
        <PageKicker label="Externalized intelligence OS" value={personaStatus} />
        <h1 className="hero-title">Never think alone again.</h1>
        <p className="hero-text">
          Think Tank is a retro strategic war room where five opinionated AI minds
          attack, expand, monetize, ground, and mature your ideas in real time.
          It is not a chat box. It is a council chamber for ambitious decisions.
        </p>
        <div className="hero-actions">
          <button type="button" className="pixel-button" onClick={handleStartQuest}>
            Initialize Council
          </button>
          <button type="button" className="pixel-button-alt" onClick={handleWatchDemo}>
            Read the Flow
          </button>
        </div>
        <div className="achievement-row" aria-label="Product capabilities">
          <span className="achievement-chip">Structured conflict</span>
          <span className="achievement-chip">Live streaming</span>
          <span className="achievement-chip">Artifact review</span>
          <span className="achievement-chip">Session vault</span>
        </div>
      </section>

      <section className="command-screen" aria-label="Council preview">
        <div className="screen-topline">
          <span>THINKTANK://BOOT</span>
          <span>{session ? "ROOM ACTIVE" : "ROOM IDLE"}</span>
        </div>
        <div className="party-lineup">
          {FALLBACK_PERSONAS.map((persona) => (
            <div key={persona.name} className="party-slot">
              <PixelAvatar name={persona.name} compact />
              <span>{persona.name}</span>
            </div>
          ))}
        </div>
        <div className="terminal-card">
          <p>&gt; load problem</p>
          <p>&gt; assemble cognitive archetypes</p>
          <p>&gt; pressure-test assumptions</p>
          <p className="terminal-hot">&gt; synthesize next move</p>
        </div>
      </section>

      <section className="section-band full-bleed">
        <div className="band-card">
          <span className="band-index">01</span>
          <h2>Bring the messy idea.</h2>
          <p>Drop the raw thought, pitch, feature, decision, business model, or artifact before it is polished.</p>
        </div>
        <div className="band-card">
          <span className="band-index">02</span>
          <h2>Pick the pressure.</h2>
          <p>Choose imagination, investor interrogation, hostile critique, or co-founder synthesis.</p>
        </div>
        <div className="band-card">
          <span className="band-index">03</span>
          <h2>Leave with leverage.</h2>
          <p>The output should be sharper thinking: risks, pivots, next actions, and the argument behind them.</p>
        </div>
      </section>
    </main>
  );

  const renderWarRoom = () => (
    <main className="app-page war-grid">
      <section className="room-stage">
        <div className="stage-header">
          <div>
            <PageKicker label="Live council chamber" value={mode} />
            <h1 className="page-title">War Room</h1>
          </div>
          <button
            type="button"
            className="pixel-button"
            onClick={handleLaunch}
            disabled={isLaunching}
          >
            {isLaunching ? "Booting..." : session ? "New Session" : "Launch Room"}
          </button>
        </div>

        <div className="video-grid" aria-label="Persona room">
          {selectedPersonaObjects.map((persona) => (
            <button
              key={persona.name}
              type="button"
              className="persona-monitor"
              data-speaking={activePersona === persona.name}
              onClick={() => setActivePersona(persona.name)}
            >
              <PixelAvatar name={persona.name} />
              <span className="monitor-name">{persona.name}</span>
              <span className="monitor-role">{PERSONA_META[persona.name]?.species ?? persona.role}</span>
            </button>
          ))}
          <button type="button" className="persona-monitor add-monitor" onClick={() => goToPage("personas")}>
            <span className="add-glyph">+</span>
            <span className="monitor-name">Invite Mind</span>
            <span className="monitor-role">Open persona deck</span>
          </button>
        </div>

        <div className="feed-panel">
          <div className="panel-heading">
            <div>
              <h2>Council Feed</h2>
              <p>{session ? `Session ${session.id.slice(0, 8)}` : "Launch a room to begin."}</p>
            </div>
            <span className="status-chip">{statusMessage}</span>
          </div>
          <div className="debate-scroll">
            {feed.length === 0 && (
              <div className="empty-feed">
                <strong>No turns yet.</strong>
                <span>Start with one specific problem. The room gets sharper when the prompt has stakes.</span>
              </div>
            )}
            {feed.map((entry) => (
              <article key={entry.id} className="debate-turn" data-user={entry.speaker === "User"}>
                <div className="turn-meta">
                  <span>{entry.speaker}</span>
                  <time>{entry.time}</time>
                </div>
                <p>
                  {entry.content
                    ? entry.speaker === "User"
                      ? entry.content
                      : normalizePersonaText(entry.content)
                    : "Receiving signal..."}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <aside className="control-stack">
        <section className="control-card hot-card">
          <h2>Turn Console</h2>
          <p className="microcopy">One human prompt. One active mind. Change the speaker any time.</p>
          <label className="field-label">Active Speaker</label>
          <select
            className="pixel-select"
            value={activePersona}
            onChange={(event) => setActivePersona(event.target.value)}
          >
            {selectedPersonas.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className="field-label">Prompt</label>
          <textarea
            className="pixel-textarea command-input"
            placeholder="What are we deciding, building, naming, testing, or killing?"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <button
            type="button"
            className="pixel-button full-button"
            onClick={handleSend}
            disabled={isSending}
          >
            {isSending ? "Streaming..." : "Send to Council"}
          </button>
          <div className="focus-strip">Focus: {activePersonaData?.focus ?? "Select a persona."}</div>
        </section>

        <section className="control-card">
          <h2>Context Cargo</h2>
          <p className="microcopy">Attach source material when the council needs evidence, not vibes.</p>
          <input
            className="pixel-input"
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(event) => setArtifactFile(event.target.files?.[0] ?? null)}
          />
          <div className="inline-actions">
            <button
              type="button"
              className="pixel-button-alt"
              onClick={handleUpload}
              disabled={!artifactFile}
            >
              Upload
            </button>
            <span>PDF, TXT, MD. Max 5MB.</span>
          </div>
          {artifactStatus && <p className="status-line">{artifactStatus}</p>}
        </section>

        <section className="control-card">
          <h2>Extract</h2>
          <p className="microcopy">Save the session when the debate creates a useful artifact.</p>
          <div className="inline-actions">
            <button type="button" className="pixel-button-alt" onClick={() => handleExport("md")} disabled={isExporting}>
              Markdown
            </button>
            <button type="button" className="pixel-button-alt" onClick={() => handleExport("pdf")} disabled={isExporting}>
              PDF
            </button>
          </div>
          {exportStatus && <p className="status-line">{exportStatus}</p>}
        </section>
      </aside>
    </main>
  );

  const renderPersonas = () => (
    <main className="app-page">
      <PageKicker label="Persona deck" value={`${selectedPersonas.length} invited`} />
      <div className="page-split-heading">
        <div>
          <h1 className="page-title">Assemble the Council</h1>
          <p className="page-copy">Each persona is a cognitive job, not decoration. Select the minds that create the right kind of useful tension.</p>
        </div>
        <button type="button" className="pixel-button" onClick={() => goToPage("war-room")}>
          Enter Room
        </button>
      </div>
      <section className="persona-deck">
        {personas.map((persona) => {
          const meta = PERSONA_META[persona.name];
          const selected = selectedPersonas.includes(persona.name);
          return (
            <article key={persona.name} className="persona-card" data-selected={selected}>
              <div className="persona-card-top">
                <PixelAvatar name={persona.name} />
                <div>
                  <span className="persona-stat">{meta?.stat ?? persona.role}</span>
                  <h2>{persona.name}</h2>
                  <p>{meta?.archetype ?? persona.role}</p>
                </div>
              </div>
              <p className="persona-quote">{meta?.quote ?? persona.tagline}</p>
              <div className="persona-details">
                <span>{meta?.species ?? persona.role}</span>
                <span>{persona.focus}</span>
                <span>{meta?.signal ?? persona.tagline}</span>
              </div>
              <div className="persona-actions">
                <button type="button" className="pixel-button-alt" onClick={() => togglePersona(persona.name)}>
                  {selected ? "Dismiss" : "Invite"}
                </button>
                <button type="button" className="pixel-button-alt" onClick={() => setActivePersona(persona.name)}>
                  {activePersona === persona.name ? "Speaking" : "Make Speaker"}
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );

  const renderModes = () => (
    <main className="app-page">
      <PageKicker label="Pressure selector" value={mode} />
      <div className="page-split-heading">
        <div>
          <h1 className="page-title">Choose the Room's Temperament</h1>
          <p className="page-copy">Modes should change behavior, not labels. Pick the emotional and intellectual pressure your idea needs right now.</p>
        </div>
        <button type="button" className="pixel-button" onClick={() => goToPage("war-room")}>
          Apply in Room
        </button>
      </div>
      <section className="mode-board">
        {MODES.map((item, index) => (
          <button
            key={item.name}
            type="button"
            className="mode-card"
            data-active={mode === item.name}
            onClick={() => setMode(item.name)}
          >
            <span className="mode-number">0{index + 1}</span>
            <h2>{item.name}</h2>
            <p>{item.description}</p>
            <strong>{item.intent}</strong>
            <span>{item.ritual}</span>
          </button>
        ))}
      </section>
      <section className="mode-note">
        <h2>Current protocol: {activeMode.name}</h2>
        <p>{activeMode.intent}</p>
      </section>
    </main>
  );

  const renderVault = () => (
    <main className="app-page">
      <PageKicker label="Session vault" value={sessionsStatus || `${sessions.length} saved`} />
      <div className="page-split-heading">
        <div>
          <h1 className="page-title">Reload Past Thinking</h1>
          <p className="page-copy">The vault keeps sessions separate from the live room so old work does not clutter new thinking.</p>
        </div>
        <button type="button" className="pixel-button-alt" onClick={() => void refreshSessions()}>
          Refresh Vault
        </button>
      </div>
      <section className="vault-grid">
        {sessions.length === 0 && (
          <article className="vault-card empty-vault">
            <h2>No saved sessions yet.</h2>
            <p>Launch a council and send a prompt. Saved cloud sessions will appear here.</p>
            <button type="button" className="pixel-button" onClick={handleLaunch} disabled={isLaunching}>
              Launch First Session
            </button>
          </article>
        )}
        {sessions.map((item) => (
          <article key={item.id} className="vault-card" data-current={session?.id === item.id}>
            <span className="vault-mode">{item.mode ?? "Council"}</span>
            <h2>{item.title ?? "Untitled Council"}</h2>
            <p>Created {formatTurnTime(item.createdAt)}</p>
            <button type="button" className="pixel-button-alt" onClick={() => handleLoadSession(item)}>
              Load Into War Room
            </button>
          </article>
        ))}
      </section>
    </main>
  );

  const renderGuide = () => (
    <main className="app-page guide-grid">
      <section>
        <PageKicker label="Human-centered flow" value="No maze" />
        <h1 className="page-title">How to Use the Council Without Fighting the UI</h1>
        <p className="page-copy">The interface now separates the mental jobs: learn on Home, configure Personas and Modes, work in War Room, recover work in Vault.</p>
        <div className="guide-steps">
          <article>
            <span>1</span>
            <h2>Start with stakes.</h2>
            <p>Write the decision, idea, or artifact in plain language. The council performs better when it knows what success and failure mean.</p>
          </article>
          <article>
            <span>2</span>
            <h2>Invite opposing minds.</h2>
            <p>Pair Devil with Tyson for ambition under attack, or Bison with Bucks when execution and business model need to agree.</p>
          </article>
          <article>
            <span>3</span>
            <h2>Change the speaker deliberately.</h2>
            <p>Do not ask every persona the same vague thing. Ask each mind for its natural contribution.</p>
          </article>
          <article>
            <span>4</span>
            <h2>Export only after synthesis.</h2>
            <p>The value is not the transcript. The value is the decision, angle, pivot, or next action that emerges.</p>
          </article>
        </div>
      </section>

      <aside className="auth-console">
        <h2>Access Console</h2>
        <p>{requiresAuth ? "Cloud sessions are enabled through Supabase." : "Supabase is not configured; local/guest behavior is available."}</p>
        <div className="access-readout">
          <span>Session</span>
          <strong>{session ? "Active" : "Idle"}</strong>
          <span>Access</span>
          <strong>{requiresAuth ? authSession?.user?.email ?? "Guest / signed out" : "Local mode"}</strong>
          <span>Persona API</span>
          <strong>{personaStatus}</strong>
        </div>
        {requiresAuth && (
          <div className="auth-actions">
            {authSession ? (
              <button type="button" className="pixel-button-alt" onClick={handleSignOut}>
                Sign Out
              </button>
            ) : (
              <>
                <button type="button" className="pixel-button" onClick={handleSignIn}>
                  Sign In with GitHub
                </button>
                <input
                  className="pixel-input"
                  type="email"
                  value={emailSignIn}
                  onChange={(event) => setEmailSignIn(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
                <button
                  type="button"
                  className="pixel-button-alt"
                  onClick={handleEmailSignIn}
                  disabled={isEmailSignInLoading}
                >
                  {isEmailSignInLoading ? "Sending..." : "Send Magic Link"}
                </button>
              </>
            )}
          </div>
        )}
        {authMessage && <p className="status-line">{authMessage}</p>}
      </aside>
    </main>
  );

  const renderActivePage = () => {
    switch (activePage) {
      case "war-room":
        return renderWarRoom();
      case "personas":
        return renderPersonas();
      case "modes":
        return renderModes();
      case "vault":
        return renderVault();
      case "guide":
        return renderGuide();
      default:
        return renderHome();
    }
  };

  return (
    <div className="min-h-screen app-shell">
      <header className="site-header">
        <div className="brand-lockup" role="banner">
          <button type="button" className="brand-mark" onClick={() => goToPage("home")} aria-label="Go home">
            <span />
          </button>
          <div>
            <p>AI Council</p>
            <span>Think Tank Protocol</span>
          </div>
        </div>
        <nav className="page-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.page}
              type="button"
              className="nav-link"
              data-current={activePage === item.page}
              onClick={() => goToPage(item.page)}
            >
              <span>{item.label}</span>
              <small>{item.helper}</small>
            </button>
          ))}
        </nav>
        <button type="button" className="pixel-button header-cta" onClick={handleStartQuest}>
          {session ? "Enter Room" : "Start"}
        </button>
      </header>

      {renderActivePage()}

      <footer className="site-footer">
        <span>Think Tank Protocol v0.1</span>
        <span>{statusMessage}</span>
      </footer>
    </div>
  );
}
