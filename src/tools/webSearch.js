import { htmlToText } from "./webFetch.js";

export const schema = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web and return a list of result titles, URLs, and snippets. Use to find current information or documentation.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        max_results: { type: "integer", description: "Max results to return (default 6)" },
      },
      required: ["query"],
    },
  },
};

// Uses DuckDuckGo's no-JS HTML endpoint — no API key required.
export async function run({ query, max_results }) {
  const cap = max_results || 6;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (freecode)" },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`search failed: ${err.message} (offline?)`);
  } finally {
    clearTimeout(timer);
  }

  const html = await res.text();
  const results = [];
  // Each result link: <a class="result__a" href="...">Title</a>
  const linkRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(html)) && results.length < cap) {
    let href = m[1];
    // DuckDuckGo wraps targets in a redirect: /l/?uddg=<encoded>
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    const title = htmlToText(m[2]).text;
    results.push({ title, url: href });
  }

  // Snippets: <a class="result__snippet">...</a>
  const snipRe = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let i = 0;
  let s;
  while ((s = snipRe.exec(html)) && i < results.length) {
    results[i].snippet = htmlToText(s[1]).text.slice(0, 300);
    i++;
  }

  if (!results.length) {
    return { query, results: [], note: "no results parsed (DuckDuckGo may have changed layout or blocked the request)" };
  }
  return { query, results };
}
