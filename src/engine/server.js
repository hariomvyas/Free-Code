import { spawn } from "node:child_process";
import net from "node:net";
import { serverPath } from "./state.js";

// Manages a local llama.cpp `llama-server` process: picks a free port, launches
// it against the chosen GGUF, waits for /health to report the model is loaded,
// and exposes an OpenAI-compatible base URL the LLM client talks to. One engine
// per Free Code process; stopped on exit.
export class Engine {
  constructor({ modelPath, ngl = 999, ctx = 8192, threads = 0, host = "127.0.0.1" }) {
    this.modelPath = modelPath;
    this.ngl = ngl;
    this.ctx = ctx;
    this.threads = threads;
    this.host = host;
    this.port = null;
    this.proc = null;
    this.stderr = "";
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  async start({ onLog = () => {}, timeoutMs = 180_000 } = {}) {
    this.port = await freePort();
    const args = [
      "-m", this.modelPath,
      "--host", this.host,
      "--port", String(this.port),
      "-c", String(this.ctx),
      "-ngl", String(this.ngl),
      "--jinja", // use the model's built-in chat template for correct formatting
    ];
    if (this.threads > 0) args.push("-t", String(this.threads));

    this.proc = spawn(serverPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stdout.on("data", (d) => onLog(d.toString()));
    this.proc.stderr.on("data", (d) => {
      // llama-server logs load progress + errors to stderr; keep the tail so a
      // failed start can report why.
      this.stderr = (this.stderr + d.toString()).slice(-4000);
      onLog(d.toString());
    });

    let exited = null;
    this.proc.on("exit", (code) => {
      exited = code;
    });

    // Poll /health until the model is loaded ("status":"ok") or we give up.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (exited !== null) {
        throw new Error(`llama-server exited (code ${exited}) during startup:\n${this.stderr}`);
      }
      if (await this._healthy()) return this;
      await sleep(500);
    }
    this.stop();
    throw new Error(`llama-server did not become healthy within ${timeoutMs}ms:\n${this.stderr}`);
  }

  async _healthy() {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (!res.ok) return false; // 503 while the model is still loading
      const data = await res.json().catch(() => ({}));
      return data.status === "ok" || res.status === 200;
    } catch {
      return false;
    }
  }

  stop() {
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill();
      } catch {
        // already gone
      }
    }
    this.proc = null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Ask the OS for an unused TCP port by binding to 0 and reading it back.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}
