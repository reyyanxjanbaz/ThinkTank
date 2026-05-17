import { execFileSync, spawn } from "node:child_process";
import net from "node:net";
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

const toText = (value) => `${value ?? ""}`.trim();

const getListeningPid = (port) => {
  try {
    const output = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" }
    );
    const pid = toText(output).split("\n")[0];
    return pid || null;
  } catch {
    return null;
  }
};

const getProcessCommand = (pid) => {
  try {
    return toText(
      execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8"
      })
    );
  } catch {
    return "";
  }
};

const isLikelyThinkTankApi = (command) => {
  const normalized = command.toLowerCase();
  return (
    normalized.includes("thinktank/apps/api") ||
    normalized.includes("thinktank\\apps\\api") ||
    normalized.includes("dist/server.js") ||
    normalized.includes("src/server.ts")
  );
};

const killPid = (pid) => {
  try {
    process.kill(Number(pid), "SIGTERM");
    return true;
  } catch {
    return false;
  }
};

const forceKillPid = (pid) => {
  try {
    process.kill(Number(pid), "SIGKILL");
    return true;
  } catch {
    return false;
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const checkPortOpen = (port, host = "127.0.0.1") =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(800);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(Number(port), host);
  });

const checkApiHealth = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1200)
    });

    if (!response.ok) {
      return false;
    }

    const payload = await response.json();
    return payload?.status === "ok";
  } catch {
    return false;
  }
};

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

const spawnService = (service) => {
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
};

const startServices = async () => {
  for (const service of services) {
    let isOccupied = await checkPortOpen(service.port);

    if (service.name === "api" && isOccupied) {
      const healthy = await checkApiHealth(service.port);
      if (healthy) {
        console.log(
          `[dev] Reusing existing API on http://localhost:${service.port} (health check passed).`
        );
        continue;
      }

      const pid = getListeningPid(service.port);
      const command = pid ? getProcessCommand(pid) : "";
      if (pid && isLikelyThinkTankApi(command)) {
        console.warn(
          `[dev] Detected stale ThinkTank API process on port ${service.port} (pid ${pid}). Restarting it.`
        );
        killPid(pid);
        await wait(400);
        isOccupied = await checkPortOpen(service.port);
        if (isOccupied) {
          forceKillPid(pid);
          await wait(250);
          isOccupied = await checkPortOpen(service.port);
        }
      }

      if (isOccupied) {
        console.error(
          `[dev] Port ${service.port} is occupied by another process and API health check failed.`
        );
        if (pid) {
          console.error(`[dev] Occupying pid: ${pid}`);
        }
        if (command) {
          console.error(`[dev] Occupying command: ${command}`);
        }
        console.error(
          `[dev] Resolve conflict and retry: lsof -nP -iTCP:${service.port} -sTCP:LISTEN`
        );
        shutdown(1);
        return;
      }
    }

    if (service.name === "web" && isOccupied) {
      console.log(
        `[dev] Reusing existing web server on http://localhost:${service.port}.`
      );
      continue;
    }

    spawnService(service);
  }
};

console.log("[dev] API -> http://localhost:3001");
console.log("[dev] WEB -> http://localhost:5173");
console.log(`[dev] API mode -> ${watchApi ? "watch" : "standard"}`);
console.log("[dev] Press Ctrl+C to stop.");

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await startServices();
