// Terminal display helpers: colors, a live "thinking" spinner, and tool-activity
// formatting. Everything degrades to plain, single-shot prints when stdout is not
// a TTY (e.g. piped to a file), so logs stay clean.

const isTTY = process.stdout.isTTY;

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
};

const color = (c, s) => (isTTY ? `${C[c]}${s}${C.reset}` : s);

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
      process.stdout.write(`${color("gray", "· " + this.label + " …")}\n`);
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
    const meta = `${elapsed}s · ${this.tokens} tok`;
    process.stdout.write(
      `\r${color("cyan", f)} ${this.label} ${color("gray", meta)}${" ".repeat(6)}`
    );
  }

  end(summaryLabel) {
    if (this.timer) clearInterval(this.timer);
    const elapsed = ((Date.now() - this.start) / 1000).toFixed(1);
    if (isTTY) {
      process.stdout.write("\r" + " ".repeat(process.stdout.columns || 60) + "\r");
    }
    if (summaryLabel) {
      console.log(color("gray", `  ${summaryLabel} (${elapsed}s, ${this.tokens} tok)`));
    }
  }
}

export function printToolCall(name, args) {
  const argStr = JSON.stringify(args);
  const shown = argStr.length > 160 ? argStr.slice(0, 160) + "…" : argStr;
  console.log(`${color("magenta", "🔧 " + name)} ${color("gray", shown)}`);
}

export function printToolResult(name, resultText, ok) {
  let preview = resultText;
  try {
    const parsed = JSON.parse(resultText);
    if (parsed.error) {
      console.log(`   ${color("red", "✗ " + parsed.error)}`);
      return;
    }
    // Summarize common result shapes.
    if (parsed.bytesWritten !== undefined) preview = `wrote ${parsed.bytesWritten} bytes → ${parsed.path}`;
    else if (parsed.replacements !== undefined) preview = `${parsed.replacements} replacement(s) → ${parsed.path}`;
    else if (parsed.count !== undefined) preview = `${parsed.count} match(es)`;
    else if (parsed.totalLines !== undefined) preview = `read ${parsed.totalLines} line(s)`;
    else if (parsed.exitCode !== undefined) preview = `exit ${parsed.exitCode}`;
    else preview = resultText.slice(0, 160);
  } catch {
    preview = resultText.slice(0, 160);
  }
  console.log(`   ${color(ok ? "green" : "yellow", "✓ " + preview)}`);
}

export function printAnswer(text) {
  console.log(`\n${color("bold", "◆ freecode")} ${text}\n`);
}

export function printBanner(lines) {
  for (const l of lines) console.log(l);
}

export { color };
