import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const watchApi = process.argv.includes("--watch-api");

const services = [
  {
    name: "api",
    cwd: path.join(rootDir, "apps/api"),
    port: "3001",
    script: watchApi ? "dev:watch" : "dev"
  },
  { name: "web", cwd: path.join(rootDir, "apps/web"), port: "5173", script: "dev" }
];

const children = [];
let shuttingDown = false;

const killChildren = () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
};

const shutdown = (code = 0) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  killChildren();
  setTimeout(() => {
    process.exit(code);
  }, 150);
};

for (const service of services) {
  const child = spawn("npm", ["run", service.script], {
    cwd: service.cwd,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32"
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const exitCode = code ?? (signal ? 1 : 0);
    console.error(
      `[dev] ${service.name} exited (${signal ? `signal ${signal}` : `code ${exitCode}`}). Stopping all services.`
    );
    shutdown(exitCode);
  });

  child.on("error", (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[dev] failed to start ${service.name}: ${error.message}`);
    shutdown(1);
  });

  children.push(child);
}

console.log("[dev] API -> http://localhost:3001");
console.log("[dev] WEB -> http://localhost:5173");
console.log(`[dev] API mode -> ${watchApi ? "watch" : "standard"}`);
console.log("[dev] Press Ctrl+C to stop.");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
