import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_DIR } from "./config.js";

const SESSIONS_DIR = path.join(PROJECT_DIR, "sessions");

function newId() {
  const d = new Date();
  const stamp = d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${stamp}_${rand}`;
}

// A conversation that can be persisted to and restored from disk.
export class Session {
  constructor({ id, model, messages, title, createdAt } = {}) {
    this.id = id || newId();
    this.model = model || null;
    this.messages = messages || [];
    this.title = title || "";
    this.createdAt = createdAt || new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  // Title = first user message (trimmed), set once.
  deriveTitle() {
    if (this.title) return;
    const firstUser = this.messages.find(
      (m) => m.role === "user" && !m.content.startsWith("[tool_result:")
    );
    if (firstUser) this.title = firstUser.content.slice(0, 60).replace(/\s+/g, " ");
  }

  async save() {
    this.deriveTitle();
    this.updatedAt = new Date().toISOString();
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const file = path.join(SESSIONS_DIR, `${this.id}.json`);
    const data = {
      id: this.id,
      model: this.model,
      title: this.title,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messages: this.messages,
    };
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
  }

  static async load(id) {
    const file = path.join(SESSIONS_DIR, `${id}.json`);
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    return new Session(data);
  }

  // Returns metadata for all saved sessions, newest first.
  static async list() {
    let files;
    try {
      files = await fs.readdir(SESSIONS_DIR);
    } catch {
      return [];
    }
    const out = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const data = JSON.parse(await fs.readFile(path.join(SESSIONS_DIR, f), "utf8"));
        out.push({
          id: data.id,
          title: data.title || "(untitled)",
          model: data.model,
          updatedAt: data.updatedAt,
          turns: (data.messages || []).filter((m) => m.role === "user" && !String(m.content).startsWith("[tool_result:")).length,
        });
      } catch {
        // skip corrupt session file
      }
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
}
