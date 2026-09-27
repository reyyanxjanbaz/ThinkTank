import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Session as SupabaseSession } from "@supabase/supabase-js";
import type { Persona, Session, Turn } from "./lib/types";
import {
  createSession,
  deleteSession,
  getPersonas,
  generateExport,
  generateTitle,
  listArtifacts,
  listSessions,
  listTurns,
  renameSession,
  streamGuestPersonaResponse,
  streamPersonaResponse,
  uploadArtifact,
  validatePrompt
} from "./lib/api";
import { hasSupabaseConfig, supabase } from "./lib/supabaseClient";
import { PersonaSprite } from "./sprites";
import Sidebar from "./Sidebar";
import { HeatBars, PRESSURE, PressureControl, PressureStrip, pressureFor } from "./Pressure";
import Home from "./Home";
import CouncilPanel from "./CouncilPanel";
import Composer from "./Composer";
import { RoomDecor } from "./Decor";
import { commandForMode, parsePrompt } from "./lib/tokens";
import {
  FALLBACK_PERSONAS,
  MODES,
  STARTER_PROMPTS,
  personaStyle
} from "./lib/council";

const readView = () =>
  typeof window !== "undefined" && window.location.hash.startsWith("#/app") ? "app" : "home";

type FeedItem = {
  id: string;
  speaker: string;
  content: string;
  time: string;
  /** The stream failed: content is the error note, not a saved reply. */
  failed?: boolean;
};

type AuthMode = "login" | "signup";

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const CONFIGURED_API_URL = (
  import.meta.env.VITE_API_URL?.trim() || (import.meta.env.PROD ? "" : "http://localhost:3001")
).replace(/\/$/, "");

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const makeLocalSession = (mode: string, title?: string): Session => {
  const timestamp = new Date().toISOString();
  const resolvedTitle = title?.trim() || "Untitled Council (Local)";
  return {
    id: `local-${makeId()}`,
    title: resolvedTitle,
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

const PLACEHOLDER_TITLE = "New council";

type NamingToken = { id: string; title: string | null };

const TITLE_STOPWORDS = new Set(
  (
    "a an the i im i'm me my we our us you your it its is are was were be been am to of for in on at by with " +
    "and or but so if then than that this these those what which who whom how why when where should would " +
    "could can will shall do does did give tell help make want need think about like please just really some " +
    "any any more most very much many get got let lets let's smart move idea good bad ok okay"
  ).split(" ")
);

// Offline fallback when the model can't name the council: keep the topic words, drop the request words.
const fallbackTitle = (text: string) => {
  const words = text
    .split("\n")[0]
    .replace(/[^\p{L}\p{N}$%'’-]+/gu, " ")
    .split(" ")
    .filter((word) => word && !TITLE_STOPWORDS.has(word.toLowerCase()));
  if (words.length === 0) return PLACEHOLDER_TITLE;
  return words
    .slice(0, 4)
    .map((word) => (/^[a-z]/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
};

// Older API builds stored the user's message once per persona in an "everyone" round,
// so saved transcripts read: question, Devil, question, Tyson... Drop a user turn that
// repeats the previous one within the same round (only persona replies in between).
const ROUND_WINDOW_MS = 10 * 60 * 1000;
const withoutRepeatedQuestions = (turns: Turn[]) => {
  let lastQuestion: Turn | null = null;
  return turns.filter((turn) => {
    if (turn.persona !== "User") return true;
    const repeat =
      lastQuestion !== null &&
      lastQuestion.content.trim() === turn.content.trim() &&
      Math.abs(new Date(turn.createdAt).getTime() - new Date(lastQuestion.createdAt).getTime()) <
        ROUND_WINDOW_MS;
    if (!repeat) lastQuestion = turn;
    return !repeat;
  });
};

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

function PixelAvatar({
  name,
  compact = false,
  talking = false
}: {
  name: string;
  compact?: boolean;
  talking?: boolean;
}) {
  return (
    <div className={compact ? "avatar-shell avatar-shell-compact" : "avatar-shell"} data-talking={talking}>
      <PersonaSprite name={name} talking={talking} className="pixel-avatar" />
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
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authRecoveryPassword, setAuthRecoveryPassword] = useState("");
  const [authRecoveryPasswordConfirm, setAuthRecoveryPasswordConfirm] = useState("");
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);
  const [isRecoveryFlow, setIsRecoveryFlow] = useState(false);
  const [mode, setMode] = useState(MODES[0].name);
  const [sessionTitle, setSessionTitle] = useState("");
  const [selectedPersonas, setSelectedPersonas] = useState<string[]>(FALLBACK_PERSONAS.map((persona) => persona.name));
  const [activePersona, setActivePersona] = useState("Devil");
  const [prompt, setPrompt] = useState("");
  const [artifactFileState, setArtifactFile] = useState<File | null>(null);
  const [artifactStatus, setArtifactStatus] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsStatus, setSessionsStatus] = useState("");
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState("");
  const [hasNewFeed, setHasNewFeed] = useState(false);
  const [view, setView] = useState<"home" | "app">(readView);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem("tt-sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [isCouncilOpen, setIsCouncilOpen] = useState(false);
  // Who answers the next message: any mix of seated minds, answering in seat order.
  const [askList, setAskList] = useState<string[]>(() => FALLBACK_PERSONAS.map((persona) => persona.name));
  const [speakingNow, setSpeakingNow] = useState<string | null>(null);
  const [roundQueue, setRoundQueue] = useState<string[]>([]);
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const namingRef = useRef<NamingToken | null>(null);
  // Titles set in this tab. A list response that was already in flight (or a server that
  // couldn't save the rename) must not put the placeholder back.
  const titleOverridesRef = useRef(new Map<string, string>());
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const accessToken = authSession?.access_token ?? "";
  const isSignedIn = Boolean(authSession?.access_token);
  const authRedirectTo =
    import.meta.env.VITE_AUTH_REDIRECT_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : undefined);
  const authIdentity = requiresAuth
    ? authSession?.user?.email ?? authSession?.user?.id ?? "Signed out"
    : "Local mode";

  const isFeedNearBottom = (element: HTMLDivElement) =>
    element.scrollHeight - element.scrollTop - element.clientHeight < 48;

  const scrollFeedToBottom = (behavior: ScrollBehavior = "auto") => {
    const element = feedScrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
  };

  const refreshSessions = async (tokenOverride?: string) => {
    const token = tokenOverride ?? accessToken;

    if (requiresAuth && !token) {
      setSessions([]);
      return;
    }

    setSessionsStatus("Loading sessions...");
    try {
      const data = await listSessions(token);
      const overrides = titleOverridesRef.current;
      setSessions(
        data.sessions.map((item) => {
          const local = overrides.get(item.id);
          if (!local) return item;
          if (item.title === local) {
            overrides.delete(item.id);
            return item;
          }
          return { ...item, title: local };
        })
      );
      setSessionsStatus("");
    } catch (error) {
      // Keep whatever list we already have; a failed refresh shouldn't erase it.
      setSessionsStatus("Couldn't load your saved councils. Check your connection and try again.");
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
        if (data.session) {
          setAuthMode("login");
          setIsRecoveryFlow(false);
        }
      })
      .finally(() => {
        if (!active) return;
        setIsAuthInitializing(false);
      });

    const { data } = supabase.auth.onAuthStateChange((event, sessionData) => {
      if (!active) return;
      setAuthSession(sessionData ?? null);
      setIsAuthInitializing(false);

      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryFlow(true);
        setAuthMessage("Password recovery session detected. Set your new password.");
      }

      if (event === "SIGNED_IN") {
        setAuthMode("login");
        setIsRecoveryFlow(false);
      }

      if (event === "SIGNED_OUT") {
        setIsRecoveryFlow(false);
      }
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    // Only a real page switch (home <-> app) resets scroll; in-page anchors must not.
    const syncView = () => {
      const next = readView();
      setView((current) => {
        if (current !== next) window.scrollTo(0, 0);
        return next;
      });
    };
    window.addEventListener("hashchange", syncView);
    return () => window.removeEventListener("hashchange", syncView);
  }, []);

  const openApp = () => {
    window.location.hash = "#/app";
  };

  const goHome = () => {
    window.location.hash = "#/";
  };

  // Grow the composer with its content, up to a cap.
  useEffect(() => {
    const element = promptRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [prompt]);

  useEffect(() => {
    if (!isDrawerOpen && !isCouncilOpen) return;
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsDrawerOpen(false);
      setIsCouncilOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isDrawerOpen, isCouncilOpen]);

  const clearPasswordInputs = () => {
    setAuthPassword("");
    setAuthPasswordConfirm("");
    setAuthRecoveryPassword("");
    setAuthRecoveryPasswordConfirm("");
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

  const personaNames = useMemo(() => personas.map((persona) => persona.name), [personas]);
  // "/court" and "@Bucks" typed in the message. Parsed once for the highlight, the hints and the send.
  const parsed = useMemo(() => parsePrompt(prompt, personaNames), [prompt, personaNames]);
  const chipTargets = selectedPersonas.filter((name) => askList.includes(name));
  // A mention wins over the chips for this message, and may call in a benched mind. Answers keep seat order.
  const mentionsLead = parsed.mentions.length > 0;
  const askTargets = mentionsLead
    ? personaNames.filter((name) => parsed.mentions.includes(name))
    : chipTargets;
  const askEveryone =
    selectedPersonas.length > 1 &&
    askTargets.length === selectedPersonas.length &&
    askTargets.every((name) => selectedPersonas.includes(name));

  const personaLookup = useMemo(() => {
    const map = new Map(personas.map((persona) => [persona.name, persona]));
    return map;
  }, [personas]);


  useEffect(() => {
    const element = feedScrollRef.current;
    if (!element) return;
    // Follow the conversation until the reader scrolls up; resume when they return to the bottom.
    // Streaming grows the content between scroll events, so only an upward
    // scroll counts as the reader leaving the bottom.
    let lastTop = element.scrollTop;
    const handleScroll = () => {
      const top = element.scrollTop;
      if (isFeedNearBottom(element)) {
        stickToBottomRef.current = true;
        setHasNewFeed(false);
      } else if (top < lastTop - 4) {
        stickToBottomRef.current = false;
      }
      lastTop = top;
    };
    handleScroll();
    element.addEventListener("scroll", handleScroll);
    return () => {
      element.removeEventListener("scroll", handleScroll);
    };
  }, [isSignedIn]);

  useEffect(() => {
    const element = feedScrollRef.current;
    // Nothing said yet: the welcome screen reads from the top, so there's no bottom to follow.
    if (!element || feed.length === 0) return;
    if (stickToBottomRef.current) {
      scrollFeedToBottom();
      setHasNewFeed(false);
      return;
    }
    if (feed.length > 0) {
      setHasNewFeed(true);
    }
  }, [feed]);

  const togglePersona = (name: string) => {
    setSelectedPersonas((prev) => {
      if (prev.includes(name)) {
        if (prev.length === 1) return prev;
        return prev.filter((persona) => persona !== name);
      }
      // If everyone seated was answering, the newcomer answers too.
      setAskList((list) => (prev.every((seated) => list.includes(seated)) ? [...list, name] : list));
      return [...prev, name];
    });
  };


  const handleSignInWithGitHub = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    setAuthMessage("Redirecting to GitHub...");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: authRedirectTo
      }
    });

    if (error) {
      setAuthMessage(`GitHub sign-in failed: ${error.message}`);
    }
  };

  const handleEmailPasswordSignIn = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    const email = authEmail.trim();
    if (!email || !authPassword) {
      setAuthMessage("Enter your email and password.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage("Signing in...");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: authPassword
    });

    if (error) {
      setAuthMessage(`Login failed: ${error.message}`);
      setIsAuthSubmitting(false);
      return;
    }

    clearPasswordInputs();
    setAuthMessage("Signed in.");
    setIsAuthSubmitting(false);
  };

  const handleEmailPasswordSignUp = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    const email = authEmail.trim();
    if (!email || !authPassword || !authPasswordConfirm) {
      setAuthMessage("Enter email, password, and confirm password.");
      return;
    }

    if (authPassword.length < 8) {
      setAuthMessage("Use at least 8 characters for password.");
      return;
    }

    if (authPassword !== authPasswordConfirm) {
      setAuthMessage("Passwords do not match.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage("Creating account...");

    const { data, error } = await supabase.auth.signUp({
      email,
      password: authPassword,
      options: {
        emailRedirectTo: authRedirectTo
      }
    });

    if (error) {
      setAuthMessage(`Sign-up failed: ${error.message}`);
      setIsAuthSubmitting(false);
      return;
    }

    if (!data.session) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: authPassword
      });

      if (signInError) {
        const normalized = signInError.message.toLowerCase();
        if (
          normalized.includes("email not confirmed") ||
          normalized.includes("email_not_confirmed")
        ) {
          setAuthMessage(
            "Account created, but Supabase email confirmation is enabled. Disable Confirm Email in Supabase Auth settings."
          );
        } else {
          setAuthMessage(`Sign-up succeeded but auto-login failed: ${signInError.message}`);
        }
        setIsAuthSubmitting(false);
        return;
      }
    }

    clearPasswordInputs();
    setAuthMessage("Account created and signed in.");
    setIsAuthSubmitting(false);
  };

  const handleSendResetLink = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    const email = authEmail.trim();
    if (!email) {
      setAuthMessage("Enter your account email to reset password.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage("Sending password reset link...");

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: authRedirectTo
    });

    if (error) {
      setAuthMessage(`Password reset failed: ${error.message}`);
      setIsAuthSubmitting(false);
      return;
    }

    setAuthMessage("Password reset link sent. Check your email.");
    setIsAuthSubmitting(false);
  };

  const handleUpdateRecoveryPassword = async () => {
    if (!supabase) {
      setAuthMessage("Supabase not configured.");
      return;
    }

    if (!isRecoveryFlow && !authSession) {
      setAuthMessage("Open the password recovery link from your email first.");
      return;
    }

    if (!authRecoveryPassword || !authRecoveryPasswordConfirm) {
      setAuthMessage("Enter and confirm your new password.");
      return;
    }

    if (authRecoveryPassword.length < 8) {
      setAuthMessage("Use at least 8 characters for the new password.");
      return;
    }

    if (authRecoveryPassword !== authRecoveryPasswordConfirm) {
      setAuthMessage("New passwords do not match.");
      return;
    }

    setIsAuthSubmitting(true);
    setAuthMessage("Updating password...");

    const { error } = await supabase.auth.updateUser({
      password: authRecoveryPassword
    });

    if (error) {
      setAuthMessage(`Password update failed: ${error.message}`);
      setIsAuthSubmitting(false);
      return;
    }

    clearPasswordInputs();
    setIsRecoveryFlow(false);
    setAuthMode("login");
    setAuthMessage("Password updated. You can now sign in.");
    setIsAuthSubmitting(false);
  };

  const handleSignOut = async () => {
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    clearPasswordInputs();
    setAuthMessage("Signed out.");
  };

  const handleUpload = async (fileArg?: File) => {
    const artifactFile = fileArg ?? artifactFileState;
    if (!session) {
      setArtifactStatus("Send your first message, then attach files.");
      return;
    }

    if (!artifactFile) {
      setArtifactStatus("Choose a file to upload.");
      return;
    }

    if (artifactFile.size > MAX_ARTIFACT_BYTES) {
      setArtifactStatus(`${artifactFile.name} is over 5 MB. Try a smaller or text-only version.`);
      return;
    }

    if (requiresAuth && !accessToken) {
      setArtifactStatus("Sign in before uploading artifacts.");
      return;
    }

    setArtifactStatus(`Uploading ${artifactFile.name}...`);

    try {
      const response = await uploadArtifact(session.id, artifactFile, accessToken);
      setArtifactStatus(`Reading ${artifactFile.name}...`);
      setArtifactFile(null);

      const startedAt = Date.now();
      const maxWaitMs = 20000;
      const pollIntervalMs = 1000;

      while (Date.now() - startedAt < maxWaitMs) {
        await wait(pollIntervalMs);
        const { artifacts } = await listArtifacts(session.id, accessToken);
        const latest = artifacts.find((artifact) => artifact.id === response.artifact.id);
        if (!latest) {
          continue;
        }

        if (latest.status === "ready") {
          const parsedLength = latest.parsedText?.trim().length ?? 0;
          if (parsedLength === 0 && latest.mime === "application/pdf") {
            setArtifactStatus(
              "Upload complete, but this PDF has little/no extractable text (likely scanned or image-only)."
            );
          } else {
            setArtifactStatus(`${latest.filename} is in the room. The council will use it as context.`);
          }
          return;
        }

        if (latest.status === "failed") {
          setArtifactStatus(
            "Upload succeeded, but parsing failed for this file. Try a text-based PDF/TXT/MD."
          );
          return;
        }
      }

      setArtifactStatus("Upload succeeded. Parsing is still in progress; retry your prompt in a few seconds.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown upload error";
      setArtifactStatus(message);
    }
  };

  const handleLaunch = async (titleHint?: string, modeOverride?: string): Promise<Session | null> => {
    if (isLaunching) return null;

    if (requiresAuth && (isAuthInitializing || !accessToken)) {
      setStatusMessage("Checking sign-in state. Try again in a moment.");
      return null;
    }

    const resolvedTitle = sessionTitle.trim() || titleHint?.trim() || "Untitled Council";
    const launchMode = modeOverride ?? mode;
    setIsLaunching(true);
    setStatusMessage("");

    const setStartedState = (nextSession: Session, message: string) => {
      setSession(nextSession);
      setFeed([]);
      setArtifactStatus("");
      setExportStatus("");
      setStatusMessage(message);
    };

    try {
      const response = await createSession(
        {
          title: resolvedTitle,
          mode: launchMode
        },
        accessToken
      );
      setStartedState(response.session, "");
      void refreshSessions(accessToken);
      return response.session;
    } catch (error) {
      if (requiresAuth) {
        setStatusMessage("Couldn't open the room. The API or Supabase isn't responding.");
        return null;
      }
      const localSession = makeLocalSession(launchMode, resolvedTitle);
      setStartedState(
        localSession,
        "API unreachable. Running as a local draft for now."
      );
      return localSession;
    } finally {
      setIsLaunching(false);
    }
  };

  const handleLoadSession = async (target: Session) => {
    // Switching mid-round would let the remaining replies land in the other council.
    if (isSending || target.id === session?.id) {
      setIsDrawerOpen(false);
      return;
    }
    if (requiresAuth && !accessToken) {
      setSessionsStatus("Sign in to load saved sessions.");
      return;
    }

    setSession(target);
    setMode(target.mode ?? mode);
    setStatusMessage("Loading transcript...");
    setFeed([]);
    namingRef.current = null;
    stickToBottomRef.current = true;
    setIsDrawerOpen(false);

    try {
      const data = await listTurns(target.id, accessToken);
      const loadedFeed = withoutRepeatedQuestions(data.turns).map((turn) => ({
        id: turn.id,
        speaker: turn.persona,
        content: turn.content,
        time: formatTurnTime(turn.createdAt)
      }));
      setFeed(loadedFeed);
      setStatusMessage("");
    } catch (error) {
      setFeed([]);
      setStatusMessage("Couldn't load this council's transcript. Pick it again from the list to retry.");
    }
  };

  // Takes the minutes of any saved council, not only the open one: it's offered from each row's menu.
  // A finished export message steps aside after a few seconds; one in progress stays.
  useEffect(() => {
    if (isExporting || !exportStatus) return;
    const timer = window.setTimeout(() => setExportStatus(""), 6000);
    return () => window.clearTimeout(timer);
  }, [exportStatus, isExporting]);

  const handleExport = async (format: "md" | "pdf", target: Session) => {
    if (isExporting) return;
    if (target.id.startsWith("local-")) {
      setExportStatus("This council is a local draft, so there are no saved minutes to export yet.");
      return;
    }

    if (requiresAuth && !accessToken) {
      setExportStatus("Sign in before exporting.");
      return;
    }

    setIsExporting(true);

    try {
      setExportStatus(`Taking the minutes of ${target.title ?? "this council"} as ${format === "md" ? "Markdown" : "PDF"}...`);
      const response = await generateExport(target.id, format, accessToken);
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
      setExportStatus("Couldn't take the minutes: the export service didn't respond. Try again in a moment.");
    } finally {
      setIsExporting(false);
    }
  };

  const getStreamFailureMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (import.meta.env.PROD && message.includes("API base resolution failed")) {
      return "The council can't reach the server right now. Try again in a moment.";
    }
    if (message.includes("API base resolution failed")) {
      return `${message} From repo root, run "npm run dev", then open ${CONFIGURED_API_URL}/health and confirm status=ok in your browser.`;
    }
    if (
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("Load failed")
    ) {
      if (import.meta.env.PROD) {
        return "The council can't reach the server right now. Try again in a moment.";
      }
      return `API server is unreachable. From repo root, run "npm run dev", then open ${CONFIGURED_API_URL}/health and confirm it returns status=ok.`;
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
    if (message.includes("rate_limited")) {
      // The API's own limit (30 LLM calls a minute per visitor by default).
      return "The council needs a breather: too many questions in the last minute. Try again shortly.";
    }
    if (message.includes("invalid_request")) {
      return "The stream request was invalid. Check persona, mode, and prompt length.";
    }
    if (import.meta.env.PROD) {
      return "This mind couldn't answer just now. Try again in a moment.";
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
              content: failureMessage,
              failed: true
            }
          : item
      )
    );
  };

  // Names a new council from its opening message, off the critical path of the first reply.
  // The token follows the council if its local draft is promoted to a saved session, and a
  // new council or a loaded one replaces the token, so a late title can't land elsewhere.
  const nameCouncil = async (token: NamingToken, openingMessage: string) => {
    let title: string;
    try {
      title = (await generateTitle(openingMessage, accessToken)).title;
    } catch {
      title = fallbackTitle(openingMessage);
    }
    if (namingRef.current !== token) return;
    token.title = title;
    applyTitle(token.id, title);
  };

  const applyTitle = (sessionId: string, title: string) => {
    if (!sessionId.startsWith("local-")) titleOverridesRef.current.set(sessionId, title);
    setSession((prev) => (prev && prev.id === sessionId ? { ...prev, title } : prev));
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? { ...item, title } : item)));
    if (!sessionId.startsWith("local-")) {
      // Refresh after saving so an earlier in-flight list request can't bring back the old title.
      void renameSession(sessionId, title, accessToken)
        .then(() => refreshSessions())
        .catch(() => {
          // The title still shows here; the saved list keeps the placeholder until reload.
        });
    }
  };

  const handleSend = async () => {
    if (isSending) return;
    const roundMode = parsed.command?.mode ?? mode;
    // A leading /command sets the pressure; the rest of the message is what gets sent.
    const trimmed = parsed.message;
    if (!trimmed) {
      if (parsed.command) {
        setMode(parsed.command.mode);
        setPrompt("");
        promptRef.current?.focus();
        return;
      }
      setStatusMessage("Type what you want the council to look at.");
      promptRef.current?.focus();
      return;
    }

    if (askTargets.length === 0) {
      setStatusMessage("Pick at least one mind to answer.");
      return;
    }

    if (requiresAuth && !accessToken) {
      setStatusMessage(isAuthInitializing ? "Checking sign-in state. Try again in a moment." : "Sign in to continue.");
      return;
    }

    let activeSession = session;
    if (!activeSession) {
      activeSession = await handleLaunch(PLACEHOLDER_TITLE, roundMode);
      if (!activeSession) return;
      const token: NamingToken = { id: activeSession.id, title: null };
      namingRef.current = token;
      void nameCouncil(token, trimmed);
    }

    setIsSending(true);

    let effectiveToken = accessToken;

    if (requiresAuth && !effectiveToken) {
      setStatusMessage("Sign in to continue.");
      setIsSending(false);
      return;
    }

    if (activeSession.id.startsWith("local-") && (!requiresAuth || Boolean(effectiveToken))) {
      try {
        const localId = activeSession.id;
        const naming = namingRef.current?.id === localId ? namingRef.current : null;
        const response = await createSession(
          {
            title: naming?.title ?? activeSession.title ?? PLACEHOLDER_TITLE,
            mode: activeSession.mode ?? roundMode
          },
          effectiveToken
        );
        activeSession = response.session;
        setSession(response.session);
        if (naming) {
          naming.id = response.session.id;
          // The title may have arrived while the draft was being saved.
          if (naming.title && naming.title !== response.session.title) {
            applyTitle(response.session.id, naming.title);
          }
        }
        await refreshSessions(effectiveToken);
      } catch {
        // stay in local draft mode if cloud bootstrap fails
      }
    }

    const useCloudStreaming =
      !activeSession.id.startsWith("local-") && (!requiresAuth || Boolean(effectiveToken));

    if (!useCloudStreaming && requiresAuth) {
      setStatusMessage("Session unavailable. Start a new council.");
      setIsSending(false);
      return;
    }

    const targets = askTargets.slice();

    if (useCloudStreaming) {
      try {
        await validatePrompt(
          { sessionId: activeSession.id, persona: targets[0], prompt: trimmed },
          effectiveToken
        );
      } catch {
        setStatusMessage("That prompt was blocked, or the API isn't responding.");
        setIsSending(false);
        return;
      }
    }

    const history = feed
      .filter((item) => !item.failed && item.content.trim())
      .slice(-12)
      .map((item) => ({
        speaker:
          item.speaker === "User" || personaLookup.has(item.speaker)
            ? item.speaker
            : "User",
        content: item.content
      }));

    // The round is going ahead: only now apply the /command pressure and seat
    // any benched mind called by name, so a refused send changes nothing.
    if (parsed.command) setMode(parsed.command.mode);
    const benchedMentions = targets.filter((name) => !selectedPersonas.includes(name));
    if (benchedMentions.length > 0) {
      setSelectedPersonas((prev) => personaNames.filter((name) => prev.includes(name) || benchedMentions.includes(name)));
    }

    setFeed((prev) => [
      ...prev,
      { id: makeId(), speaker: "User", content: trimmed, time: formatClock() }
    ]);
    setPrompt("");

    // Streams one persona's reply into a fresh feed entry and returns the full text.
    const streamOne = async (persona: string, followUp: boolean) => {
      const responseId = makeId();
      let collected = "";
      setFeed((prev) => [
        ...prev,
        { id: responseId, speaker: persona, content: "", time: formatClock() }
      ]);
      const appendToken = (token: string) => {
        collected += token;
        setFeed((prev) =>
          prev.map((item) =>
            item.id === responseId ? { ...item, content: `${item.content}${token}` } : item
          )
        );
      };
      const streamGuest = () =>
        streamGuestPersonaResponse(
          { persona, prompt: trimmed, mode: roundMode, history: history.slice(-20), followUp },
          { onToken: appendToken }
        );

      if (!useCloudStreaming) {
        try {
          await streamGuest();
        } catch (error) {
          writeStreamFailureToFeed(responseId, error);
        }
        return collected;
      }

      try {
        await streamPersonaResponse(
          activeSession.id,
          { persona, prompt: trimmed, mode: roundMode, followUp },
          effectiveToken,
          { onToken: appendToken }
        );
      } catch (error) {
        if (requiresAuth) {
          writeStreamFailureToFeed(responseId, error);
        } else {
          collected = "";
          setFeed((prev) =>
            prev.map((item) => (item.id === responseId ? { ...item, content: "" } : item))
          );
          try {
            await streamGuest();
          } catch (guestError) {
            writeStreamFailureToFeed(responseId, guestError);
          }
        }
      }
      return collected;
    };

    try {
      stickToBottomRef.current = true;
      for (const [index, persona] of targets.entries()) {
        setRoundQueue(targets.slice(index + 1));
        setSpeakingNow(persona);
        setStatusMessage(`${persona} is speaking...`);
        const reply = await streamOne(persona, index > 0);
        // Later speakers hear the question and the earlier replies, so they can build on and argue.
        if (index === 0) history.push({ speaker: "User", content: trimmed });
        if (reply.trim()) history.push({ speaker: persona, content: reply });
      }
      setStatusMessage("");
    } finally {
      setSpeakingNow(null);
      setRoundQueue([]);
      setIsSending(false);
      // The saved list now has this round's turns; refresh so every slot shows current counts and speakers.
      if (useCloudStreaming) void refreshSessions(effectiveToken);
    }
  };

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((value) => {
      try {
        window.localStorage.setItem("tt-sidebar-collapsed", value ? "0" : "1");
      } catch {
        // Remembering the rail is a convenience only.
      }
      return !value;
    });
  };

  const handleRenameCouncil = (id: string, title: string) => {
    if (namingRef.current?.id === id) namingRef.current = null;
    applyTitle(id, title);
  };

  // Deletes a council for good. Returns an error message to show, or null when it's gone.
  const handleDeleteSession = async (target: Session): Promise<string | null> => {
    const isOpen = target.id === session?.id;
    if (isOpen && (isSending || isLaunching)) {
      return "The council is still answering. Delete it once this round finishes.";
    }
    if (requiresAuth && !accessToken) {
      return "Sign in to delete councils.";
    }
    if (!target.id.startsWith("local-")) {
      try {
        await deleteSession(target.id, accessToken);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        // Already gone on the server: treat it as deleted and tidy the list.
        if (!message.includes("(404)")) {
          return "Couldn't delete this council: the server didn't confirm it. Nothing was removed, so try again.";
        }
      }
    }
    titleOverridesRef.current.delete(target.id);
    if (namingRef.current?.id === target.id) namingRef.current = null;
    setSessions((prev) => prev.filter((item) => item.id !== target.id));
    if (isOpen) {
      // The open council is gone: land on a fresh one instead of a transcript that no longer exists.
      setSession(null);
      setFeed([]);
      setPrompt("");
      setArtifactFile(null);
      setArtifactStatus("");
      setStatusMessage("");
      setIsCouncilOpen(false);
    }
    return null;
  };

  const startNewCouncil = () => {
    if (isSending) return;
    namingRef.current = null;
    setSession(null);
    setFeed([]);
    setSessionTitle("");
    setPrompt("");
    setArtifactFile(null);
    setArtifactStatus("");
    setExportStatus("");
    setStatusMessage("");
    setIsCouncilOpen(false);
    setIsDrawerOpen(false);
    window.setTimeout(() => promptRef.current?.focus(), 0);
  };

  const lastFeedId = feed[feed.length - 1]?.id;
  // The open council's save-slot numbers, straight from its transcript.
  const liveSummary = useMemo(() => {
    // An empty feed is a transcript still loading (or a brand-new council): keep the server's numbers.
    if (!session || feed.length === 0) return null;
    // A failed stream shows its error in the feed but was never saved, so it isn't a turn.
    const replies = feed.filter((item) => item.speaker !== "User" && !item.failed && item.content.trim());
    const speakers: string[] = [];
    for (const item of replies) if (!speakers.includes(item.speaker)) speakers.push(item.speaker);
    return { id: session.id, turnCount: replies.length, speakers };
  }, [session, feed]);
  // One starter per pressure level, coolest first; picking one also sets that pressure.
  const starters = PRESSURE.map((stop) => ({
    mode: stop.mode,
    text: (STARTER_PROMPTS[stop.mode] ?? STARTER_PROMPTS.Brainstorm)[0]
  }));
  const isFreshRoom = !session && feed.length === 0;
  const visibleNotice = !isSending && statusMessage ? statusMessage : "";

  // A starter carries its pressure as a /command, which also shows people the shortcut exists.
  const applyStarter = (text: string, starterMode: string) => {
    const command = commandForMode(starterMode);
    setPrompt(command ? `/${command.word} ${text}` : text);
    promptRef.current?.focus();
  };

  const toggleAsk = (name: string) => {
    setAskList((list) => (list.includes(name) ? list.filter((item) => item !== name) : [...list, name]));
    setActivePersona(name);
  };

  const pickSpeaker = (name: string) => {
    setAskList([name]);
    setActivePersona(name);
  };

  const personaState = (name: string) => {
    if (speakingNow === name) return "Speaking";
    if (!selectedPersonas.includes(name)) return "Benched";
    if (isSending) return roundQueue.includes(name) ? "Up next" : "Listening";
    if (askTargets.includes(name)) return "Answers next";
    return "Listening";
  };

  const benchPersona = (name: string) => {
    if (selectedPersonas.includes(name)) togglePersona(name);
  };

  const seatPersona = (name: string) => {
    if (!selectedPersonas.includes(name)) togglePersona(name);
  };

  const renderComposer = () => (
    <Composer
      personas={personas}
      seated={selectedPersonas}
      targets={askTargets}
      mentionsLead={mentionsLead}
      askEveryone={askEveryone}
      speakingNow={speakingNow}
      onAskEveryone={() => setAskList(selectedPersonas.slice())}
      onToggleAsk={toggleAsk}
      onBench={benchPersona}
      onSeat={seatPersona}
      prompt={prompt}
      parsed={parsed}
      onPromptChange={setPrompt}
      promptRef={promptRef}
      onSend={() => void handleSend()}
      isSending={isSending}
      isLaunching={isLaunching}
      isFresh={isFreshRoom}
      canAttach={Boolean(session)}
      attachLabel={artifactFileState?.name ?? ""}
      attachStatus={artifactStatus}
      onAttach={(file) => {
        setArtifactFile(file);
        void handleUpload(file);
      }}
      onDismissAttach={() => {
        setArtifactFile(null);
        setArtifactStatus("");
      }}
    />
  );

  const renderStarters = () => (
    <div className="starter-grid">
      {starters.map(({ mode: starterMode, text }) => {
        const stop = pressureFor(starterMode);
        return (
          <button
            key={text}
            type="button"
            className="starter"
            style={{ "--heat": stop.heat } as CSSProperties}
            onClick={() => applyStarter(text, starterMode)}
            title={`Starts at ${stop.name} (${stop.mode})`}
          >
            <span className="starter-head" aria-hidden="true">
              <HeatBars level={stop.level} />
              <code>/{commandForMode(starterMode)?.word}</code>
            </span>
            <span>{text}</span>
          </button>
        );
      })}
    </div>
  );

  const renderWelcome = () => (
    <section className="welcome" aria-labelledby="welcome-title">
      <h1 className="welcome-title" id="welcome-title">
        What should the council look at?
      </h1>

      <div className="welcome-pressure">
        <PressureControl variant="dial" mode={mode} onChange={setMode} />
      </div>

      {renderComposer()}
      {renderStarters()}
    </section>
  );

  const renderCouncilPanel = () => (
    <CouncilPanel
      Avatar={PixelAvatar}
      personas={personas}
      selectedPersonas={selectedPersonas}
      togglePersona={togglePersona}
      activePersona={activePersona}
      askEveryone={askEveryone}
      askTargets={askTargets}
      pickSpeaker={pickSpeaker}
      speakingNow={speakingNow}
      roundQueue={roundQueue}
      isSending={isSending}
      feed={feed}
      mode={mode}
      modeControl={<PressureControl variant="panel" mode={mode} onChange={setMode} />}
      stateOf={personaState}
      rosterOffline={personaStatus === "error"}
      isOpen={isCouncilOpen}
      onClose={() => setIsCouncilOpen(false)}
    />
  );

  const renderRoom = () => (
    <main className="room" data-fresh={isFreshRoom}>
      <RoomDecor speaker={speakingNow} />
      <header className="room-bar">
        <button
          type="button"
          className="icon-button menu-button"
          onClick={() => setIsDrawerOpen(true)}
          aria-label="Open past councils"
          aria-expanded={isDrawerOpen}
        >
          <span className="burger" aria-hidden="true" />
        </button>
        <h1 className="room-title">{session?.title ?? PLACEHOLDER_TITLE}</h1>
        {!isFreshRoom && <PressureControl variant="compact" mode={mode} onChange={setMode} />}
        {!isFreshRoom && (
        <button
          type="button"
          className="council-button"
          onClick={() => setIsCouncilOpen(true)}
          aria-expanded={isCouncilOpen}
          aria-label="Open council panel"
        >
          <span className="council-faces" aria-hidden="true">
            {selectedPersonas.slice(0, 5).map((name) => (
              <span key={name} style={personaStyle(name)}>
                <PixelAvatar name={name} compact />
              </span>
            ))}
          </span>
        </button>
        )}
      </header>
      {!isFreshRoom && <PressureStrip mode={mode} />}

      <p className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </p>

      <div className="feed" ref={feedScrollRef}>
        <div className="feed-inner">
          {isFreshRoom && renderWelcome()}
          {!isFreshRoom && feed.length === 0 && (
            <div className="empty-feed">
              <p>The floor is open. Ask something with real stakes, or start from one of these:</p>
              {renderStarters()}
            </div>
          )}
          {feed.map((entry) => {
            const isUser = entry.speaker === "User";
            if (isUser) {
              return (
                <article key={entry.id} className="turn turn-user">
                  <p>{entry.content}</p>
                </article>
              );
            }
            const streaming = isSending && entry.id === lastFeedId;
            return (
              <article
                key={entry.id}
                className="dlg"
                style={personaStyle(entry.speaker)}
                data-streaming={streaming}
                aria-label={`${entry.speaker}, ${entry.time}`}
              >
                <header className="dlg-plate">
                  <strong>{entry.speaker}</strong>
                  <time>{entry.time}</time>
                </header>
                <span className="dlg-face" aria-hidden="true">
                  <PixelAvatar name={entry.speaker} compact talking={streaming && speakingNow === entry.speaker} />
                </span>
                <p className="dlg-text">
                  {entry.content ? normalizePersonaText(entry.content) : <span className="thinking">thinking</span>}
                </p>
              </article>
            );
          })}
        </div>
        {hasNewFeed && (
          <button type="button" className="jump-latest" onClick={() => scrollFeedToBottom("smooth")}>
            New replies below
          </button>
        )}
      </div>

      {!isFreshRoom && (
        <footer className="dock">
          {visibleNotice && (
            <p className="notice" role="alert">
              {visibleNotice}
            </p>
          )}
          {renderComposer()}
        </footer>
      )}
      {isFreshRoom && visibleNotice && (
        <p className="notice notice-floating" role="alert">
          {visibleNotice}
        </p>
      )}
    </main>
  );

  const renderAuthGate = () => (
    <main className="auth-gate">
      <section className="auth-gate-shell">
        <article className="auth-gate-hero">
          <button type="button" className="text-button back-home" onClick={goHome}>
            Back to home
          </button>
          <h1 className="page-title">Sign in to open your councils.</h1>
          <p className="page-copy">
            Your councils, uploads and exports are saved to your account, so you can pick up any argument where it stopped.
          </p>
          <div className="gate-party" aria-hidden="true">
            {FALLBACK_PERSONAS.map((persona) => (
              <span key={persona.name} style={personaStyle(persona.name)}>
                <PixelAvatar name={persona.name} compact />
              </span>
            ))}
          </div>
        </article>

        <article className="auth-gate-panel">
          {isAuthInitializing ? (
            <p className="status-line">Checking sign-in state...</p>
          ) : isRecoveryFlow ? (
            <div className="auth-actions">
              <h2>Set New Password</h2>
              <label className="field-label" htmlFor="recovery-password">New password</label>
              <input
                id="recovery-password"
                className="pixel-input"
                type="password"
                value={authRecoveryPassword}
                onChange={(event) => setAuthRecoveryPassword(event.target.value)}
                placeholder="New password"
                autoComplete="new-password"
              />
              <label className="field-label" htmlFor="recovery-password-confirm">Confirm new password</label>
              <input
                id="recovery-password-confirm"
                className="pixel-input"
                type="password"
                value={authRecoveryPasswordConfirm}
                onChange={(event) => setAuthRecoveryPasswordConfirm(event.target.value)}
                placeholder="Confirm new password"
                autoComplete="new-password"
              />
              <p className="microcopy">Minimum 8 characters.</p>
              <button
                type="button"
                className="pixel-button"
                onClick={handleUpdateRecoveryPassword}
                disabled={isAuthSubmitting}
              >
                {isAuthSubmitting ? "Updating..." : "Update Password"}
              </button>
            </div>
          ) : (
            <div className="auth-actions">
              <div className="auth-tabs" role="tablist" aria-label="Auth mode">
                <button
                  type="button"
                  className="pixel-button-alt auth-tab"
                  data-active={authMode === "login"}
                  role="tab"
                  aria-selected={authMode === "login"}
                  onClick={() => setAuthMode("login")}
                >
                  Log In
                </button>
                <button
                  type="button"
                  className="pixel-button-alt auth-tab"
                  data-active={authMode === "signup"}
                  role="tab"
                  aria-selected={authMode === "signup"}
                  onClick={() => setAuthMode("signup")}
                >
                  Sign Up
                </button>
              </div>
              <label className="field-label" htmlFor="auth-email">Email</label>
              <input
                id="auth-email"
                className="pixel-input"
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
              <label className="field-label" htmlFor="auth-password">Password</label>
              <input
                id="auth-password"
                className="pixel-input"
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                placeholder="Password"
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
              />
              {authMode === "signup" && (
                <>
                  <label className="field-label" htmlFor="auth-password-confirm">Confirm password</label>
                  <input
                    id="auth-password-confirm"
                    className="pixel-input"
                    type="password"
                    value={authPasswordConfirm}
                    onChange={(event) => setAuthPasswordConfirm(event.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                  />
                </>
              )}
              <p className="microcopy">Minimum 8 characters.</p>

              <button
                type="button"
                className="pixel-button"
                onClick={authMode === "login" ? handleEmailPasswordSignIn : handleEmailPasswordSignUp}
                disabled={isAuthSubmitting}
              >
                {isAuthSubmitting
                  ? authMode === "login"
                    ? "Signing In..."
                    : "Creating..."
                  : authMode === "login"
                    ? "Log In"
                    : "Create Account"}
              </button>

              <div className="auth-link-row">
                <button
                  type="button"
                  className="pixel-button-alt auth-link-btn"
                  onClick={handleSendResetLink}
                  disabled={isAuthSubmitting}
                >
                  Forgot Password
                </button>
                <button
                  type="button"
                  className="pixel-button-alt auth-link-btn"
                  onClick={handleSignInWithGitHub}
                  disabled={isAuthSubmitting}
                >
                  Continue with GitHub
                </button>
              </div>
            </div>
          )}
          {authMessage && (
            <p className="status-line" role="status" aria-live="polite">
              {authMessage}
            </p>
          )}
        </article>
      </section>
    </main>
  );

  if (view === "home") {
    return <Home onStart={openApp} isSignedIn={isSignedIn || !requiresAuth} />;
  }

  if (requiresAuth && !isSignedIn) {
    return (
      <div className="gate-shell">
        {renderAuthGate()}
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      data-fresh={isFreshRoom}
      data-sidebar-collapsed={sidebarCollapsed}
      data-heat={pressureFor(mode).level}
      style={{ "--room-heat": pressureFor(mode).heat } as CSSProperties}
    >
      <Sidebar
        sessions={sessions}
        sessionsStatus={sessionsStatus}
        currentId={session?.id ?? null}
        busy={isSending || isLaunching}
        isOpen={isDrawerOpen}
        collapsed={sidebarCollapsed}
        requiresAuth={requiresAuth}
        identity={authIdentity}
        liveSummary={liveSummary}
        onExport={(target, format) => void handleExport(format, target)}
        onDelete={handleDeleteSession}
        isExporting={isExporting}
        exportStatus={exportStatus}
        onClose={() => setIsDrawerOpen(false)}
        onToggleCollapsed={toggleSidebarCollapsed}
        onHome={() => {
          setIsDrawerOpen(false);
          goHome();
        }}
        onNewCouncil={startNewCouncil}
        onOpen={(item) => void handleLoadSession(item)}
        onRefresh={() => void refreshSessions()}
        onRename={handleRenameCouncil}
        onSignOut={() => void handleSignOut()}
      />
      {renderRoom()}
      {!isFreshRoom && renderCouncilPanel()}
    </div>
  );
}
