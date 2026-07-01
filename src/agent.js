import fs from "node:fs/promises";
import path from "node:path";
import { chat, LLMError } from "./llm.js";
import { executeTool, isMutating, describeTools } from "./tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { LOG_DIR } from "./config.js";
import { Session } from "./session.js";

export class Agent {
  constructor({ config, permissionGate, session, toolRegistry }) {
    this.config = config;
    this.permissionGate = permissionGate;
    this.session = session || new Session({ model: config.model });
    // Optional extra tools (e.g. from MCP servers) merged with built-ins.
    this.toolRegistry = toolRegistry || null;

    if (this.session.messages.length === 0) {
      this.session.messages.push({
        role: "system",
        content: buildSystemPrompt(process.cwd(), this._describeTools()),
      });
    }
    this.session.model = config.model;
    this.logFile = path.join(LOG_DIR, `${this.session.id}.jsonl`);
  }

  get messages() {
    return this.session.messages;
  }

  _describeTools() {
    if (this.toolRegistry) return this.toolRegistry.describe();
    return describeTools();
  }

  async _execTool(name, args) {
    if (this.toolRegistry) return this.toolRegistry.execute(name, args);
    return executeTool(name, args);
  }

  _isMutating(name) {
    if (this.toolRegistry) return this.toolRegistry.isMutating(name);
    return isMutating(name);
  }

  async send(userText, hooks = {}) {
    const { onThinkStart, onToken, onThinkEnd, onToolCall, onToolResult, onDenied } = hooks;

    this.messages.push({ role: "user", content: userText });

    try {
      for (let i = 0; i < this.config.maxIterations; i++) {
        onThinkStart?.(i + 1);
        let tokenCount = 0;
        const assistantMsg = await chat({
          host: this.config.host,
          model: this.config.model,
          messages: this.messages,
          timeoutMs: this.config.requestTimeoutMs,
          perf: this.config.perf,
          onToken: (piece) => {
            tokenCount++;
            onToken?.(piece, tokenCount);
          },
        });
        onThinkEnd?.(tokenCount);
        this.messages.push(assistantMsg);
        await this._log(assistantMsg);

        let envelope;
        try {
          envelope = JSON.parse(assistantMsg.content);
        } catch {
          // model didn't honor the JSON envelope — surface raw text rather than crash.
          return assistantMsg.content || "";
        }

        const toolName = (envelope.tool || "").trim();
        if (!toolName) {
          return envelope.final_answer || "";
        }

        const args = envelope.arguments || {};
        onToolCall?.(toolName, args);

        let resultText;
        let ok = true;
        if (this._isMutating(toolName) && !(await this.permissionGate.check(toolName, args))) {
          onDenied?.(toolName);
          resultText = JSON.stringify({ error: "Permission denied by user." });
          ok = false;
        } else {
          try {
            const result = await this._execTool(toolName, args);
            resultText = JSON.stringify(result);
          } catch (err) {
            resultText = JSON.stringify({ error: err.message });
            ok = false;
          }
        }
        onToolResult?.(toolName, resultText, ok);

        const toolMsg = { role: "user", content: `[tool_result:${toolName}] ${resultText}` };
        this.messages.push(toolMsg);
        await this._log(toolMsg);
      }

      return "[stopped: hit max tool-call iterations without a final answer]";
    } finally {
      // Persist the session after every turn so nothing is lost on crash/exit.
      await this.session.save().catch(() => {});
    }
  }

  async _log(msg) {
    try {
      await fs.mkdir(LOG_DIR, { recursive: true });
      await fs.appendFile(this.logFile, JSON.stringify(msg) + "\n", "utf8");
    } catch {
      // logging is best-effort
    }
  }
}

export { LLMError };
