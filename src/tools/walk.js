import fs from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".freecode",
  "dist",
  "build",
  ".next",
  ".venv",
  "__pycache__",
]);

// Yields absolute file paths under root, skipping common noise directories.
// root may itself be a single file, in which case it's yielded directly.
export async function* walk(root, maxFiles = 5000) {
  const rootStat = await fs.stat(root).catch(() => null);
  if (rootStat?.isFile()) {
    yield root;
    return;
  }

  let count = 0;
  const stack = [root];
  while (stack.length && count < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        yield full;
        count++;
        if (count >= maxFiles) return;
      }
    }
  }
}

// Minimal glob-to-regex: supports **, *, ?
export function globToRegex(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/\\\\]*";
      }
    } else if (c === "?") {
      re += ".";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
