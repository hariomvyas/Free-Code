// Terminal UI: colors, rounded box panels, a live spinner, tool-activity
// rendering, and colored diffs. Pure ANSI, zero dependencies. Everything
// degrades to plain prints when stdout is not a TTY.

// Force the rich UI even when piped (useful for `| less -R` or testing).
const isTTY = process.stdout.isTTY || process.env.FREECODE_FORCE_UI === "1";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

const color = (c, s) => (isTTY ? `${C[c]}${s}${C.reset}` : s);

function width() {
  return Math.min(process.stdout.columns || 80, 100);
}

// Strips ANSI codes to measure visible length.
function visibleLen(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function wrap(text, w) {
  const out = [];
  for (const rawLine of String(text).split("\n")) {
    let line = rawLine;
    while (visibleLen(line) > w) {
      let cut = line.lastIndexOf(" ", w);
      if (cut <= 0) cut = w;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^\s/, "");
    }
    out.push(line);
  }
  return out;
}

// Draws a rounded box with an optional title. `col` colors the border/title.
export function box(title, content, col = "gray") {
  const w = width();
  const inner = w - 2;
  const lines = Array.isArray(content) ? content : wrap(content, inner - 2);

  if (!isTTY) {
    if (title) console.log(`## ${title}`);
    for (const l of lines) console.log(l);
    return;
  }

  const top =
    color(col, "╭─ ") + color(col, title || "") + color(col, " " + "─".repeat(Math.max(0, inner - visibleLen(title || "") - 3)) + "╮");
  console.log(top);
  for (const l of lines) {
    const pad = inner - 2 - visibleLen(l);
    console.log(color(col, "│ ") + l + " ".repeat(Math.max(0, pad)) + color(col, " │"));
  }
  console.log(color(col, "╰" + "─".repeat(inner) + "╯"));
}

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export class Spinner {
  constructor(label) {
    this.label = label;
    this.start = Date.now();
    this.tokens = 0;
    this.frame = 0;
    this.timer = null;
  }
  begin() {
    if (!isTTY) {
      process.stdout.write(color("gray", "· " + this.label + " …") + "\n");
      return;
    }
    this.render();
    this.timer = setInterval(() => this.render(), 100);
  }
  setTokens(n) {
    this.tokens = n;
  }
  render() {
    if (!isTTY) return;
    const elapsed = ((Date.now() - this.start) / 1000).toFixed(1);
    const f = FRAMES[(this.frame = (this.frame + 1) % FRAMES.length)];
    process.stdout.write(`\r${color("cyan", f)} ${color("dim", this.label)} ${color("gray", elapsed + "s · " + this.tokens + " tok")}   `);
  }
  end() {
    if (this.timer) clearInterval(this.timer);
    if (isTTY) process.stdout.write("\r" + " ".repeat(width()) + "\r");
  }
}

const TOOL_ICON = {
  read_file: "📖",
  write_file: "✍️ ",
  edit_file: "✏️ ",
  multi_edit: "✏️ ",
  bash: "❯",
  grep: "🔎",
  glob: "🔎",
  ls: "📂",
  web_fetch: "🌐",
  web_search: "🔍",
  browser: "🧭",
};

// Renders a colored +/- diff for a single find/replace.
function renderDiff(oldStr, newStr) {
  const lines = [];
  for (const l of String(oldStr).split("\n")) lines.push(color("red", "- " + l));
  for (const l of String(newStr).split("\n")) lines.push(color("green", "+ " + l));
  return lines;
}

export function printToolCall(name, args) {
  const icon = TOOL_ICON[name] || "🔧";
  if (name === "edit_file" && args.old_string != null) {
    console.log(`${icon} ${color("magenta", name)} ${color("gray", args.path || "")}`);
    for (const l of renderDiff(args.old_string, args.new_string).slice(0, 12)) console.log("   " + l);
    return;
  }
  if (name === "multi_edit" && Array.isArray(args.edits)) {
    console.log(`${icon} ${color("magenta", name)} ${color("gray", args.path || "")} ${color("gray", `(${args.edits.length} edits)`)}`);
    for (const e of args.edits.slice(0, 4)) for (const l of renderDiff(e.old_string, e.new_string).slice(0, 4)) console.log("   " + l);
    return;
  }
  const argStr = JSON.stringify(args);
  const shown = argStr.length > 140 ? argStr.slice(0, 140) + "…" : argStr;
  console.log(`${icon} ${color("magenta", name)} ${color("gray", shown)}`);
}

export function printToolResult(name, resultText, ok) {
  let preview = resultText;
  try {
    const p = JSON.parse(resultText);
    if (p.error) {
      console.log(`   ${color("red", "✗ " + p.error.split("\n")[0])}`);
      return;
    }
    if (p.bytesWritten !== undefined) preview = `wrote ${p.bytesWritten} bytes → ${short(p.path)}`;
    else if (p.editsApplied !== undefined) preview = `${p.editsApplied} edits → ${short(p.path)}`;
    else if (p.replacements !== undefined) preview = `${p.replacements} replacement(s) → ${short(p.path)}`;
    else if (p.count !== undefined) preview = `${p.count} result(s)`;
    else if (p.results !== undefined) preview = `${p.results.length} search result(s)`;
    else if (p.totalLines !== undefined) preview = `read ${p.totalLines} line(s)`;
    else if (p.exitCode !== undefined) preview = `exit ${p.exitCode}`;
    else if (p.title !== undefined) preview = `fetched: ${p.title || short(p.url)}`;
    else preview = resultText.slice(0, 120);
  } catch {
    preview = resultText.slice(0, 120);
  }
  console.log(`   ${color(ok ? "green" : "yellow", (ok ? "✓ " : "⚠ ") + preview)}`);
}

function short(p) {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/);
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : p;
}

export function printAnswer(text) {
  console.log();
  box(color("bold", "◆ freecode"), text, "cyan");
  console.log();
}

export function printBanner({ version, model, host, cwd, session, mcp }) {
  const lines = [
    color("bold", "Free Code ") + color("gray", "v" + version),
    color("gray", "model  ") + color("green", model) + color("gray", "   host ") + host,
    color("gray", "cwd    ") + cwd,
    color("gray", "session ") + color("dim", session),
  ];
  if (mcp) lines.push(color("gray", "mcp    ") + mcp);
  box("Free Code", lines, "blue");
}

export { color };
