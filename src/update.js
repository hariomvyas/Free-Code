import { exec } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";

const execp = promisify(exec);
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // at most once per 6 hours

// Repo root = one level up from src/.
export function installDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function entryScript() {
  return path.join(installDir(), "bin", "freecode.js");
}

// Throttle: skip the (network) check if we checked recently.
async function shouldCheck() {
  const marker = path.join(installDir(), ".last_update_check");
  try {
    const last = Number(await fs.readFile(marker, "utf8"));
    if (Date.now() - last < CHECK_INTERVAL_MS) return false;
  } catch {
    // no marker yet
  }
  await fs.writeFile(marker, String(Date.now()), "utf8").catch(() => {});
  return true;
}

async function isGitRepo(dir) {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function run(cmd, dir, timeout = 8000) {
  return execp(cmd, { cwd: dir, timeout, windowsHide: true });
}

// Checks GitHub for new commits and, for a git checkout, fast-forwards to the
// latest. Best-effort: any failure (offline, no git, network) is swallowed.
// onLog(line) reports progress. Returns { updated, restartNeeded, message }.
export async function autoUpdate(onLog = () => {}) {
  if (process.env.FREECODE_NO_UPDATE === "1" || process.argv.includes("--no-update")) {
    return { updated: false, message: "auto-update disabled" };
  }
  if (process.env.FREECODE_UPDATED === "1") {
    return { updated: false, message: "already relaunched" }; // avoid re-exec loop
  }
  if (!(await shouldCheck())) {
    return { updated: false, message: "checked recently" };
  }

  const dir = installDir();

  if (!(await isGitRepo(dir))) {
    // Non-git install (e.g. npm i -g git+url): just notify if behind.
    return notifyIfBehind(onLog);
  }

  try {
    const branch = (await run("git rev-parse --abbrev-ref HEAD", dir)).stdout.trim() || "main";
    const local = (await run("git rev-parse HEAD", dir)).stdout.trim();
    const remoteLine = (await run(`git ls-remote origin ${branch}`, dir, 6000)).stdout.trim();
    const remote = remoteLine.split(/\s+/)[0];

    if (!remote || remote === local) return { updated: false, message: "up to date" };

    onLog("update found — pulling latest…");
    // Only fast-forward; never clobber local changes.
    await run(`git pull --ff-only origin ${branch}`, dir, 20000);
    // Refresh dependencies if package.json changed (no-op for zero-dep core).
    await run("npm install --omit=dev --no-audit --no-fund", dir, 60000).catch(() => {});
    return {
      updated: true,
      restartNeeded: true,
      message: "Updated to the latest version — restart fcode to apply.",
    };
  } catch (err) {
    return { updated: false, message: `update check skipped (${short(err)})` };
  }
}

async function notifyIfBehind(onLog) {
  try {
    const localPkg = JSON.parse(await fs.readFile(path.join(installDir(), "package.json"), "utf8"));
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(
      "https://raw.githubusercontent.com/hariomvyas/Free-Code/main/package.json",
      { signal: controller.signal }
    ).finally(() => clearTimeout(t));
    if (!res.ok) return { updated: false };
    const remotePkg = await res.json();
    if (remotePkg.version && remotePkg.version !== localPkg.version) {
      onLog(
        `update available: ${localPkg.version} → ${remotePkg.version}. Run: npm install -g git+https://github.com/hariomvyas/Free-Code.git`
      );
    }
    return { updated: false };
  } catch {
    return { updated: false };
  }
}

function short(err) {
  return String(err.message || err).split("\n")[0].slice(0, 80);
}
