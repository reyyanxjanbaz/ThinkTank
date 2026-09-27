try {
  process.loadEnvFile?.();
} catch {
  // Missing .env is valid in deployed environments where vars are injected.
}

export const isProduction = process.env.NODE_ENV === "production";

const read = (name: string) => (process.env[name] ?? "").trim();

// Checks the environment once at startup and stops with one readable list of problems,
// instead of failing later on the first request that needs a missing value.
const collectEnvProblems = () => {
  const problems: string[] = [];

  const port = read("PORT");
  if (port && !/^\d+$/.test(port)) {
    problems.push(`PORT must be a whole number (got "${port}").`);
  }

  for (const name of ["MAX_ARTIFACT_SIZE", "RATE_LIMIT_MAX", "OPENAI_TEMPERATURE"]) {
    const value = read(name);
    if (value && !Number.isFinite(Number(value))) {
      problems.push(`${name} must be a number (got "${value}").`);
    }
  }

  const hasSupabaseUrl = Boolean(read("SUPABASE_URL"));
  const hasServiceRoleKey = Boolean(read("SUPABASE_SERVICE_ROLE_KEY"));
  if (hasSupabaseUrl !== hasServiceRoleKey) {
    problems.push(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together (only one of them is set)."
    );
  }

  if (isProduction) {
    const allowMemoryStore = read("ALLOW_MEMORY_STORE").toLowerCase() === "true";
    if (!hasSupabaseUrl && !hasServiceRoleKey && !allowMemoryStore) {
      problems.push(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production (or set ALLOW_MEMORY_STORE=true for a throwaway demo)."
      );
    }

    if (!read("OPENROUTER_API_KEY") && !read("OPENAI_API_KEY")) {
      problems.push("OPENROUTER_API_KEY or OPENAI_API_KEY is required in production.");
    }

    const origins = read("CORS_ORIGIN")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (origins.length === 0) {
      problems.push(
        "CORS_ORIGIN is required in production: the web app origin(s), comma-separated, e.g. https://thinktank.vercel.app."
      );
    } else if (origins.includes("*")) {
      problems.push("CORS_ORIGIN must list explicit origins in production, not *.");
    }
  }

  return problems;
};

const problems = collectEnvProblems();
if (problems.length > 0) {
  console.error(
    `Think Tank API can't start. Fix these environment variables:\n${problems
      .map((problem) => `  - ${problem}`)
      .join("\n")}`
  );
  process.exit(1);
}
