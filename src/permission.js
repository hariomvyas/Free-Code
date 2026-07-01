import fs from "node:fs/promises";
import { PERMISSIONS_FILE, PROJECT_DIR } from "./config.js";

export class PermissionGate {
  constructor(rl) {
    this.rl = rl;
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
    console.log(`\n[permission] tool "${toolName}" wants to run with args:\n${preview}`);
    const answer = (
      await this.rl.question(
        `Allow? [y]es once / [a]lways this session / [A]lways (save to project) / [n]o: `
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
    if (answer.toLowerCase() === "y") {
      return true;
    }
    return false;
  }

  async save() {
    await fs.mkdir(PROJECT_DIR, { recursive: true });
    await fs.writeFile(PERMISSIONS_FILE, JSON.stringify(this.persisted, null, 2), "utf8");
  }
}
