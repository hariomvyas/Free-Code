import readline from "node:readline";

// Full-screen terminal UI, zero dependencies, raw ANSI.
//
// Split into a PURE frame composer (composeFrame — testable without a TTY) and
// an interactive runner (Tui) that handles raw input, streaming output, resize,
// and an inline permission prompt.

const ESC = "\x1b[";
export const ANSI = {
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  clear: "\x1b[2J",
  home: "\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
};

const COL = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  invert: "\x1b[7m",
};
export const c = (name, s) => `${COL[name]}${s}${COL.reset}`;

export function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}
export function visibleLen(s) {
  return stripAnsi(s).length;
}

// Wrap a (possibly ANSI-colored) string to width w. Simple: operates on the
// visible text; color codes are kept only when the whole line fits (good enough
// for our line-oriented content, which colors whole lines).
export function wrapToWidth(line, w) {
  if (w < 1) return [line];
  if (visibleLen(line) <= w) return [line];
  // If the line has no ANSI, wrap by words; otherwise hard-cut on visible width.
  if (line === stripAnsi(line)) {
    const out = [];
    let cur = line;
    while (cur.length > w) {
      let cut = cur.lastIndexOf(" ", w);
      if (cut <= 0) cut = w;
      out.push(cur.slice(0, cut));
      cur = cur.slice(cut).replace(/^\s/, "");
    }
    out.push(cur);
    return out;
  }
  // ANSI present: strip, hard-wrap, re-apply the leading color code per chunk.
  const codeMatch = line.match(/^\x1b\[[0-9;]*m/);
  const code = codeMatch ? codeMatch[0] : "";
  const plain = stripAnsi(line);
  const out = [];
  for (let i = 0; i < plain.length; i += w) {
    out.push(code + plain.slice(i, i + w) + (code ? COL.reset : ""));
  }
  return out;
}

function padTo(line, w) {
  const pad = w - visibleLen(line);
  return pad > 0 ? line + " ".repeat(pad) : line;
}

// PURE: given state + terminal size, return the exact screen rows and where the
// cursor should sit. state = { title, lines[], scroll, input, cursor, status }.
export function composeFrame(state, cols, rows) {
  const width = Math.max(20, cols);
  const height = Math.max(6, rows);
  const out = [];

  // Header
  const title = ` ${state.title || "Free Code"} `;
  out.push(c("invert", padTo(title, width)));

  // Transcript region height
  const bodyH = height - 3; // header + status + input

  // Flatten wrapped transcript lines.
  const wrapped = [];
  for (const l of state.lines) {
    for (const seg of wrapToWidth(l, width)) wrapped.push(seg);
  }
  const scroll = Math.max(0, Math.min(state.scroll || 0, Math.max(0, wrapped.length - bodyH)));
  const end = wrapped.length - scroll;
  const start = Math.max(0, end - bodyH);
  const view = wrapped.slice(start, end);
  for (let i = 0; i < bodyH; i++) {
    out.push(view[i] != null ? padTo(view[i], width) : "");
  }

  // Status line
  const scrollHint = scroll > 0 ? c("yellow", ` ↑${scroll} (PgUp/PgDn) `) : "";
  out.push(c("dim", padTo((state.status || "") + scrollHint, width)));

  // Input line
  const prompt = state.promptMode ? c("yellow", state.promptLabel + " ") : c("cyan", "❯ ");
  const promptW = visibleLen(prompt);
  const avail = width - promptW;
  const input = state.input || "";
  const cur = state.cursor ?? input.length;
  let hscroll = 0;
  if (cur > avail - 1) hscroll = cur - (avail - 1);
  const shown = input.slice(hscroll, hscroll + avail);
  out.push(padTo(prompt + shown, width));

  return {
    rows: out.slice(0, height),
    cursorRow: height, // 1-based row for the input line (last row)
    cursorCol: promptW + (cur - hscroll) + 1, // 1-based
  };
}

export class Tui {
  constructor({ title, onSubmit, onCommand }) {
    this.title = title || "Free Code";
    this.onSubmit = onSubmit; // async (text) => void
    this.state = { title: this.title, lines: [], scroll: 0, input: "", cursor: 0, status: "" };
    this.history = [];
    this.histIdx = -1;
    this.busy = false;
    this.pendingPrompt = null; // { resolve, valid }
    this.out = process.stdout;
    this._tokens = 0;
    this._busyStart = 0;
    this._frame = 0;
    this._busyTimer = null;
  }

  start() {
    this.out.write(ANSI.altScreenOn + ANSI.clear + ANSI.home);
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    this._onKey = (str, key) => this._handleKey(str, key);
    process.stdin.on("keypress", this._onKey);
    this._onResize = () => this.render();
    this.out.on("resize", this._onResize);
    this.println(c("gray", "Type your request and press Enter. ESC interrupts a running turn · Ctrl+C quits."));
    this.render();
  }

  stop() {
    process.stdin.off("keypress", this._onKey);
    this.out.off("resize", this._onResize);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    this.out.write(ANSI.showCursor + ANSI.altScreenOff);
  }

  // Temporarily hand the terminal back to plain stdin/stdout (e.g. to run the
  // model wizard's readline). Halts the busy spinner so its timer can't repaint
  // over the wizard. resume() re-enters the alt screen and redraws.
  suspend() {
    this._stopBusy();
    this.stop();
  }
  resume() {
    this.start();
  }

  // Append a line (may contain \n) to the transcript.
  println(text = "") {
    for (const line of String(text).split("\n")) this.state.lines.push(line);
    this.state.scroll = 0; // jump to bottom on new output
    this.render();
  }

  setStatus(s) {
    this.state.status = s;
    this.render();
  }

  setTokens(n) {
    this._tokens = n;
  }

  _startBusy() {
    this._tokens = 0;
    this._busyStart = Date.now();
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this._busyTimer = setInterval(() => {
      const f = frames[(this._frame = (this._frame + 1) % frames.length)];
      const secs = ((Date.now() - this._busyStart) / 1000).toFixed(1);
      this.state.status = c("cyan", f) + c("dim", ` thinking… ${secs}s · ${this._tokens} tok`);
      this.render();
    }, 120);
  }

  _stopBusy() {
    if (this._busyTimer) clearInterval(this._busyTimer);
    this._busyTimer = null;
    this.state.status = "";
  }

  // Inline permission / question prompt. Returns the pressed key.
  ask(label, valid = ["y", "a", "A", "n"]) {
    return new Promise((resolve) => {
      this.state.promptMode = true;
      this.state.promptLabel = label;
      this.pendingPrompt = { resolve, valid };
      this.render();
    });
  }

  _resolvePrompt(answer) {
    const p = this.pendingPrompt;
    this.pendingPrompt = null;
    this.state.promptMode = false;
    this.state.promptLabel = "";
    p.resolve(answer);
    this.render();
  }

  render() {
    const cols = this.out.columns || 80;
    const rows = this.out.rows || 24;
    const frame = composeFrame(this.state, cols, rows);
    let buf = ANSI.hideCursor + ANSI.home;
    buf += frame.rows.map((r) => r + ESC + "K").join("\r\n");
    // Position cursor at input and show it.
    buf += `${ESC}${frame.cursorRow};${frame.cursorCol}H` + ANSI.showCursor;
    this.out.write(buf);
  }

  async _handleKey(str, key) {
    if (!key) return;

    // Permission / question prompt mode: capture a single valid key.
    if (this.pendingPrompt) {
      if (key.ctrl && key.name === "c") return this._quit();
      const ch = str || key.name;
      if (this.pendingPrompt.valid.includes(ch)) this._resolvePrompt(ch);
      return;
    }

    if (key.ctrl && key.name === "c") return this._quit();

    // ESC interrupts the in-flight turn (like Claude Code), without quitting.
    if (key.name === "escape") {
      if (this.busy && this._turnAbort) {
        this._turnAbort.abort();
        this.println(c("yellow", "⎋ interrupting…"));
      }
      return;
    }

    if (key.name === "pageup") {
      this.state.scroll += 5;
      return this.render();
    }
    if (key.name === "pagedown") {
      this.state.scroll = Math.max(0, this.state.scroll - 5);
      return this.render();
    }

    if (this.busy) return; // ignore text input while the agent is working

    if (key.name === "return") return this._submit();
    if (key.name === "backspace") {
      if (this.state.cursor > 0) {
        this.state.input = this.state.input.slice(0, this.state.cursor - 1) + this.state.input.slice(this.state.cursor);
        this.state.cursor--;
      }
      return this.render();
    }
    if (key.name === "left") {
      this.state.cursor = Math.max(0, this.state.cursor - 1);
      return this.render();
    }
    if (key.name === "right") {
      this.state.cursor = Math.min(this.state.input.length, this.state.cursor + 1);
      return this.render();
    }
    if (key.name === "up") return this._history(-1);
    if (key.name === "down") return this._history(1);
    if (key.name === "home") {
      this.state.cursor = 0;
      return this.render();
    }
    if (key.name === "end") {
      this.state.cursor = this.state.input.length;
      return this.render();
    }

    // Printable character.
    if (str && !key.ctrl && !key.meta && str.length === 1 && str >= " ") {
      this.state.input = this.state.input.slice(0, this.state.cursor) + str + this.state.input.slice(this.state.cursor);
      this.state.cursor++;
      return this.render();
    }
  }

  _history(dir) {
    if (!this.history.length) return;
    if (this.histIdx === -1) this.histIdx = this.history.length;
    this.histIdx = Math.max(0, Math.min(this.history.length, this.histIdx + dir));
    this.state.input = this.history[this.histIdx] || "";
    this.state.cursor = this.state.input.length;
    this.render();
  }

  async _submit() {
    const text = this.state.input.trim();
    if (!text) return;
    this.history.push(text);
    this.histIdx = -1;
    this.state.input = "";
    this.state.cursor = 0;
    this.println(c("cyan", "❯ ") + text);
    this.busy = true;
    this._startBusy();
    // Fresh abort controller per turn so ESC can interrupt just this one.
    this._turnAbort = new AbortController();
    try {
      await this.onSubmit(text, this._turnAbort.signal);
    } catch (err) {
      this.println(c("red", "[error] " + (err?.message || err)));
    }
    this._turnAbort = null;
    this._stopBusy();
    this.busy = false;
    this.render();
  }

  _quit() {
    this.stop();
    process.exit(0);
  }
}
