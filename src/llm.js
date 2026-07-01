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

// Streams the model's reply from /api/chat (NDJSON). onToken(chunk) fires for
// each partial content chunk so the caller can show live progress. Returns the
// fully accumulated message once the stream is done.
//
// timeoutMs is an *inactivity* timeout: it resets every time a chunk arrives, so
// a long-but-steadily-producing response won't be killed, but a truly stalled
// connection still is.
export async function chat({ host, model, messages, timeoutMs, onToken }) {
  const controller = new AbortController();
  let timer;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  resetTimer();

  let res;
  try {
    res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        format: RESPONSE_FORMAT,
        stream: true,
        options: { num_ctx: 8192 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new LLMError(`Ollama at ${host} stalled (no data for ${timeoutMs}ms)`);
    }
    throw new LLMError(
      `Could not reach Ollama at ${host} — is it running? ("ollama serve"). ${err.message}`
    );
  }

  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    throw new LLMError(`Ollama returned ${res.status}: ${body}`);
  }

  let content = "";
  let buffer = "";
  const decoder = new TextDecoder();

  try {
    for await (const chunk of res.body) {
      resetTimer();
      buffer += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue; // partial/garbled line; skip
        }
        if (obj.error) throw new LLMError(`Ollama error: ${obj.error}`);
        const piece = obj.message?.content || "";
        if (piece) {
          content += piece;
          onToken?.(piece);
        }
      }
    }
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if (err.name === "AbortError") {
      throw new LLMError(`Ollama at ${host} stalled (no data for ${timeoutMs}ms)`);
    }
    throw new LLMError(`Stream from ${host} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  return { role: "assistant", content };
}
