// Forces context compaction with a tiny ctx budget and a padded history,
// then verifies the transcript was summarized down and the session still works.
import { Agent } from "../src/agent.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { bootConfig } from "./_boot.js";

const { config, engine } = await bootConfig({ perf: { ...DEFAULT_CONFIG.perf, num_ctx: 1024 } });
const agent = new Agent({ config, permissionGate: { check: async () => true } });

// Pad the history with bulky prior turns so the estimate crosses the threshold.
for (let i = 0; i < 8; i++) {
  agent.session.messages.push({ role: "user", content: `Old request ${i}: ` + "x".repeat(400) });
  agent.session.messages.push({ role: "assistant", content: `Old answer ${i}: ` + "y".repeat(400) });
}
const before = agent.session.messages.length;
const beforeTokens = agent._estimateTokens();

let compacted = 0;
const reply = await agent.send("Say the word DONE and nothing else.", {
  onCompact: (n) => {
    compacted = n;
    console.log(`compaction fired on ${n} messages`);
  },
});

const after = agent.session.messages.length;
console.log(`messages: ${before} -> ${after}  | tokens ~${beforeTokens} -> ~${agent._estimateTokens()}`);
console.log(`summary present: ${agent.session.messages.some((m) => m.content.startsWith("[earlier conversation summary]"))}`);
console.log(`reply: ${reply.slice(0, 60)}`);
console.log(`\nRESULT: ${compacted > 0 && after < before ? "PASS" : "FAIL"}`);
engine.stop();
