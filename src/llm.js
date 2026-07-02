// Client for the bundled llama.cpp `llama-server`, which exposes an
// OpenAI-compatible API on a local port (see src/engine/). No Ollama, no cloud.
//
// Small local models are unreliable at native OpenAI-style tool_calls, so every
// turn is forced into a fixed JSON envelope via llama.cpp's constrained decoding
// (response_format json_schema → GBNF grammar under the hood), which is far more
// reliable on 1.5B–7B models than hoping message.tool_calls populates correctly.

export class LLMError extends Error {}

// Raw JSON schema for the envelope. Wrapped into an OpenAI response_format below.
export const RESPONSE_FORMAT = {
  type: "object",
  properties: {
    tool: { type: "string" },
    arguments: { type: "object" },
    final_answer: { type: "string" },
  },
  required: ["tool", "arguments", "final_answer"],
};

const ENVELOPE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "freecode_envelope", strict: true, schema: RESPONSE_FORMAT },
};

// Health check against the local engine. Returns { reachable, model } and never
// throws — used for a friendly startup message and the /gpu-style status.
export async function checkEngine(baseUrl, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    return { reachable: res.ok };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

// Fetch llama-server's /props (model path, context size, etc.) for `/gpu` and
// diagnostics. Returns null on failure.
export async function engineProps(baseUrl, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/props`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Plain (non-envelope) completion, used for internal tasks like summarizing old
// conversation turns during context compaction.
export async function complete({ host, prompt, timeoutMs = 60000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        stream: false,
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new LLMError(`engine returned ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

// Streams the model's reply from /v1/chat/completions (SSE). onToken(chunk)
// fires per content delta so the caller can show live progress. Returns the
// fully accumulated assistant message once the stream ends.
//
// timeoutMs is an *inactivity* timeout: it resets on every chunk, so a long but
// steadily-producing response isn't killed while a truly stalled one still is.
export async function chat({ host, messages, timeoutMs, onToken, signal }) {
  const controller = new AbortController();
  let timer;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeoutMs);
  };
  resetTimer();

  // User interrupt (e.g. ESC): abort the in-flight request when `signal` fires.
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const interrupted = () => signal?.aborted;

  let res;
  try {
    res = await fetch(`${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages,
        response_format: ENVELOPE_FORMAT,
        stream: true,
        temperature: 0.1, // low: we want deterministic, well-formed envelopes
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      if (interrupted()) throw makeInterrupt();
      throw new LLMError(`Engine at ${host} stalled (no data for ${timeoutMs}ms)`);
    }
    throw new LLMError(`Could not reach the local engine at ${host}. ${err.message}`);
  }

  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    throw new LLMError(`Engine returned ${res.status}: ${body}`);
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
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let obj;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue; // partial/garbled SSE line; skip
        }
        if (obj.error) throw new LLMError(`Engine error: ${obj.error.message || obj.error}`);
        const piece = obj.choices?.[0]?.delta?.content || "";
        if (piece) {
          content += piece;
          onToken?.(piece);
        }
      }
    }
  } catch (err) {
    if (err instanceof LLMError) throw err;
    if (err.name === "AbortError") {
      if (interrupted()) throw makeInterrupt();
      throw new LLMError(`Engine at ${host} stalled (no data for ${timeoutMs}ms)`);
    }
    throw new LLMError(`Stream from ${host} failed: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  return { role: "assistant", content };
}

// A distinct error the agent recognizes as a user interrupt (ESC), not a fault.
function makeInterrupt() {
  const e = new LLMError("interrupted");
  e.interrupted = true;
  return e;
}
