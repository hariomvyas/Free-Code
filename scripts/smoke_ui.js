// Drives the real ui.js live-display callbacks (spinner, tool call/result,
// answer) through the agent with an auto-approve gate — confirms the display
// path runs without error and files actually get built.
import fs from "node:fs/promises";
import { Agent } from "../src/agent.js";
import { bootConfig } from "./_boot.js";
import { Spinner, printToolCall, printToolResult, printAnswer } from "../src/ui.js";

const autoApprove = { check: async () => true };
const { config, engine } = await bootConfig();
const agent = new Agent({ config, permissionGate: autoApprove });

let spinner = null;
const reply = await agent.send(
  "Create a file ui_test.txt containing the word pong, then read it back and confirm.",
  {
    onThinkStart: (step) => {
      spinner = new Spinner(`thinking (step ${step})`);
      spinner.begin();
    },
    onToken: (_p, count) => spinner?.setTokens(count),
    onThinkEnd: () => {
      spinner?.end();
      spinner = null;
    },
    onToolCall: printToolCall,
    onToolResult: printToolResult,
    onDenied: (name) => console.log(`   denied: ${name}`),
  }
);
printAnswer(reply);

const exists = await fs.readFile("ui_test.txt", "utf8").catch(() => null);
console.log(`\nFILE CHECK: ${exists === null ? "MISSING" : JSON.stringify(exists)}`);
await fs.rm("ui_test.txt", { force: true });
engine.stop();
