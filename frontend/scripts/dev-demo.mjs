/* global process, setTimeout, fetch, AbortSignal, console */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const service = join(root, "agent-service");
const repository = resolve(root, "..");
// In the agent repository, use its working scripts so agent development stays authoritative.
if (!process.env.AGENT_REPOSITORY_PATH && existsSync(join(repository, "scripts", "graph.py"))) process.env.AGENT_REPOSITORY_PATH = repository;
const windows = process.platform === "win32";
const python = process.env.DEMO_PYTHON || join(service, ".venv", windows ? "Scripts/python.exe" : "bin/python");
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    try { if (windows) child.kill(); else process.kill(-child.pid, "SIGTERM"); } catch { /* already stopped */ }
  }
  setTimeout(() => process.exit(code), 250);
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env, detached: !windows });
    children.push(child);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}.`)));
  });
}
try {
  // Avoid starting a duplicate pair of servers on the demo's standard ports.
  for (const port of [3000, 8000]) {
    try {
      await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(500) });
      throw new Error(`Port ${port} is already in use. Stop that server, then run npm run demo again.`);
    } catch (error) { if (error.message.includes("already in use")) throw error; }
  }
  if (!existsSync(python)) {
    console.log("Preparing the local Python environment…");
    await run(process.env.PYTHON || (windows ? "python" : "python3"), ["-m", "venv", join(service, ".venv")]);
  }
  const requirements = join(service, "requirements.txt");
  const signature = createHash("sha256").update(readFileSync(requirements)).digest("hex");
  const marker = join(dirname(python), ".template-studio-requirements");
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== signature) {
    await run(python, ["-m", "pip", "install", "-r", requirements]);
    writeFileSync(marker, signature);
  }
  const agent = spawn(python, ["-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "8000"], { cwd: service, stdio: "inherit", env: process.env, detached: !windows });
  children.push(agent);
  agent.on("error", error => { console.error(error.message); stop(1); });
  agent.on("exit", code => { if (!stopping) stop(code || 1); });
  let ready = false;
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try { const response = await fetch("http://127.0.0.1:8000/health", { signal: AbortSignal.timeout(500) }); if (response.ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("The local agent did not start. Check the Python output above.");
  const mode = process.env.DEMO_FRONTEND_MODE === "production" ? "start" : "dev";
  const frontend = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), mode, "--hostname", "127.0.0.1", "--port", "3000"], { cwd: root, stdio: "inherit", env: { ...process.env, AGENT_API_URL: "http://127.0.0.1:8000" }, detached: !windows });
  children.push(frontend);
  frontend.on("error", error => { console.error(error.message); stop(1); });
  frontend.on("exit", code => { if (!stopping) stop(code || 1); });
  console.log("\nLocal hackathon demo: http://127.0.0.1:3000\nOpen Write summary to connect Claude. Press Ctrl+C to stop both servers.\n");
} catch (error) { console.error(error.message); stop(1); }
