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
// Reports how a currently-loaded model is split across CPU/GPU, via /api/ps.
// Returns [] when nothing is loaded. Never throws.
export async function runningModels(host, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/ps`, { signal: controller.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m) => ({
      name: m.name,
      sizeVram: m.size_vram || 0,
      size: m.size || 0,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Plain (non-envelope) completion, used for internal tasks like summarizing
// old conversation turns during context compaction.
export async function complete({ host, model, prompt, timeoutMs = 60000, perf }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { num_ctx: perf?.num_ctx ?? 8192, num_gpu: perf?.num_gpu ?? 999 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new LLMError(`Ollama returned ${res.status}`);
    const data = await res.json();
    return data.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

export async function chat({ host, model, messages, timeoutMs, onToken, perf }) {
  const controller = new AbortController();
  let timer;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  resetTimer();

  const options = { num_ctx: perf?.num_ctx ?? 8192 };
  if (perf?.num_gpu != null) options.num_gpu = perf.num_gpu;
  if (perf?.num_thread) options.num_thread = perf.num_thread;

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
        options,
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
