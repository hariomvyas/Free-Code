import fs from "node:fs/promises";
import path from "node:path";
import { chat, LLMError } from "./llm.js";
import { executeTool, isMutating, describeTools } from "./tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { LOG_DIR } from "./config.js";

export class Agent {
  constructor({ config, permissionGate }) {
    this.config = config;
    this.permissionGate = permissionGate;
    this.messages = [
      { role: "system", content: buildSystemPrompt(process.cwd(), describeTools()) },
    ];
    this.logFile = path.join(LOG_DIR, `${Date.now()}.jsonl`);
  }

  async send(userText, hooks = {}) {
    const {
      onThinkStart,
      onToken,
      onThinkEnd,
      onToolCall,
      onToolResult,
      onDenied,
    } = hooks;

    this.messages.push({ role: "user", content: userText });

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
      if (isMutating(toolName) && !(await this.permissionGate.check(toolName, args))) {
        onDenied?.(toolName);
        resultText = JSON.stringify({ error: "Permission denied by user." });
        ok = false;
      } else {
        try {
          const result = await executeTool(toolName, args);
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
