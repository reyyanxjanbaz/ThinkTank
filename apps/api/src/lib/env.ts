try {
  process.loadEnvFile?.();
} catch {
  // Missing .env is valid in deployed environments where vars are injected.
}
