// Thin client for a local Ollama server's /api/chat endpoint.
//
// Small local models are unreliable at native OpenAI-style tool_calls (tested:
// qwen2.5-coder:3b silently falls back to plain-text pseudo-JSON instead of
// populating message.tool_calls). Ollama's structured-output "format" param
// (JSON-schema-constrained decoding) is far more reliable, so every turn is
// forced into a fixed envelope shape instead of relying on native tool-calling.

export class LLMError extends Error {}

export const RESPONSE_FORMAT = {
  type: "object",
  properties: {
    tool: { type: "string" },
    arguments: { type: "object" },
    final_answer: { type: "string" },
  },
  required: ["tool", "arguments", "final_answer"],
};

// Returns { reachable, models } — never throws, used for a friendly startup check.
export async function checkOllama(host, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    if (!res.ok) return { reachable: false, models: [] };
    const data = await res.json();
    return { reachable: true, models: (data.models || []).map((m) => m.name) };
  } catch {
    return { reachable: false, models: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function chat({ host, model, messages, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        format: RESPONSE_FORMAT,
        stream: false,
        options: { num_ctx: 8192 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new LLMError(`Request to ${host} timed out after ${timeoutMs}ms`);
    }
    throw new LLMError(
      `Could not reach Ollama at ${host} — is it running? ("ollama serve"). ${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LLMError(`Ollama returned ${res.status}: ${body}`);
  }

  const data = await res.json();
  if (!data.message) {
    throw new LLMError(`Unexpected Ollama response: ${JSON.stringify(data)}`);
  }
  return data.message; // { role, content, tool_calls? }
}
