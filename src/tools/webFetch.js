export const schema = {
  type: "function",
  function: {
    name: "web_fetch",
    description:
      "Fetch a URL over HTTP(S) and return the page as readable text (HTML stripped). Use to read documentation, articles, or API responses.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch (http or https)" },
        max_chars: { type: "integer", description: "Max characters of text to return (default 6000)" },
      },
      required: ["url"],
    },
  },
};

// Strips HTML to a rough plain-text approximation without any dependency.
export function htmlToText(html) {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  const title = (s.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return { title: title.trim(), text: s };
}

export async function run({ url, max_chars }) {
  if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
  const cap = max_chars || 6000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (freecode)" },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`fetch failed: ${err.message} (offline? bad url?)`);
  } finally {
    clearTimeout(timer);
  }

  const ctype = res.headers.get("content-type") || "";
  const body = await res.text();

  if (ctype.includes("html")) {
    const { title, text } = htmlToText(body);
    return {
      url: res.url,
      status: res.status,
      title,
      text: text.slice(0, cap),
      truncated: text.length > cap,
    };
  }
  return {
    url: res.url,
    status: res.status,
    text: body.slice(0, cap),
    truncated: body.length > cap,
  };
}
