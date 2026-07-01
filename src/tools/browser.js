export const schema = {
  type: "function",
  function: {
    name: "browser",
    description:
      "Open a URL in a real headless browser (renders JavaScript) and return the visible text, and optionally save a screenshot. Use ONLY when web_fetch is insufficient because the page needs JS to render. Requires Playwright to be installed.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to open (http or https)" },
        screenshot_path: { type: "string", description: "Optional path to save a PNG screenshot" },
        max_chars: { type: "integer", description: "Max characters of text to return (default 6000)" },
      },
      required: ["url"],
    },
  },
};

// Playwright is an optional heavy dependency (downloads Chromium). We lazy-load
// it so the core stays dependency-free; if it isn't installed we return clear
// install instructions instead of crashing.
async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    return mod.chromium;
  } catch {
    return null;
  }
}

export async function run({ url, screenshot_path, max_chars }) {
  if (!/^https?:\/\//i.test(url)) throw new Error("url must start with http:// or https://");
  const chromium = await loadPlaywright();
  if (!chromium) {
    throw new Error(
      "Browser tool needs Playwright (not installed). Install it once:\n" +
        "  npm install playwright && npx playwright install chromium\n" +
        "Until then, use web_fetch for non-JS pages."
    );
  }

  const cap = max_chars || 6000;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const title = await page.title();
    const text = (await page.evaluate(() => document.body?.innerText || "")).trim();
    let shot = null;
    if (screenshot_path) {
      await page.screenshot({ path: screenshot_path, fullPage: false });
      shot = screenshot_path;
    }
    return {
      url: page.url(),
      title,
      text: text.slice(0, cap),
      truncated: text.length > cap,
      screenshot: shot,
    };
  } finally {
    await browser.close();
  }
}
