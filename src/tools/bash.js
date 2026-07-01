import { exec } from "node:child_process";

export const schema = {
  type: "function",
  function: {
    name: "bash",
    description:
      "Execute a shell command in the project directory and return stdout/stderr. Use for running tests, builds, git, listing files, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" },
        timeout_ms: { type: "integer", description: "Timeout in ms (default 30000)" },
      },
      required: ["command"],
    },
  },
};

const MAX_OUTPUT = 20_000;

export function run({ command, timeout_ms }) {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd: process.cwd(), timeout: timeout_ms || 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? error.code ?? 1 : 0,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
          timedOut: error?.killed && error?.signal === "SIGTERM" ? true : false,
        });
      }
    );
  });
}

function truncate(s) {
  if (!s) return "";
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + "\n...[truncated]" : s;
}
