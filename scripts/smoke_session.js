// Verifies session save/list/load round-trip.
import { Agent } from "../src/agent.js";
import { Session } from "../src/session.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const autoApprove = { check: async () => true };
const agent = new Agent({ config: DEFAULT_CONFIG, permissionGate: autoApprove });
const id = agent.session.id;

await agent.send("What is 2+2? Answer in one short sentence, no tools.", {});
console.log(`session id: ${id}`);
console.log(`messages after turn: ${agent.session.messages.length}`);

const listed = await Session.list();
const found = listed.find((s) => s.id === id);
console.log(`in /sessions list: ${found ? "YES" : "NO"} — title: ${found?.title}`);

const reloaded = await Session.load(id);
console.log(`reloaded messages: ${reloaded.messages.length}`);
console.log(`reload matches: ${reloaded.messages.length === agent.session.messages.length ? "PASS" : "FAIL"}`);
