import fs from "node:fs/promises";
import { PERMISSIONS_FILE, PROJECT_DIR } from "./config.js";

export class PermissionGate {
  // ask: async (promptText, argsPreview) => string   (user's answer)
  constructor(ask) {
    this.ask = ask;
    this.sessionAllow = new Set();
    this.persisted = {};
  }

  async load() {
    try {
      this.persisted = JSON.parse(await fs.readFile(PERMISSIONS_FILE, "utf8"));
    } catch {
      this.persisted = {};
    }
  }

  async check(toolName, args) {
    if (this.persisted[toolName] === "allow") return true;
    if (this.sessionAllow.has(toolName)) return true;

    const preview = JSON.stringify(args, null, 2).slice(0, 500);
    const answer = (
      await this.ask(
        `Allow "${toolName}"? [y]es once / [a]lways session / [A]lways (save) / [n]o`,
        preview
      )
    ).trim();

    if (answer === "a") {
      this.sessionAllow.add(toolName);
      return true;
    }
    if (answer === "A") {
      this.sessionAllow.add(toolName);
      this.persisted[toolName] = "allow";
      await this.save();
      return true;
    }
    if (answer.toLowerCase() === "y") return true;
    return false;
  }

  async save() {
    await fs.mkdir(PROJECT_DIR, { recursive: true });
    await fs.writeFile(PERMISSIONS_FILE, JSON.stringify(this.persisted, null, 2), "utf8");
  }
}
