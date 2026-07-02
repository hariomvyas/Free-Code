import os from "node:os";
import { execFileSync } from "node:child_process";

// Inspect the host so the first-run wizard can recommend a model tier that will
// actually run well. All detection is best-effort and never throws.
export function detectSystem() {
  return {
    totalGB: os.totalmem() / 1024 ** 3,
    freeGB: os.freemem() / 1024 ** 3,
    cpus: os.cpus()?.length || 1,
    platform: process.platform,
    arch: process.arch,
    gpu: detectGpu(),
  };
}

// Returns { kind: "cuda"|"metal"|"cpu", vramGB } — vramGB is null when unknown
// (Apple unified memory) or 0 when there's no usable GPU.
function detectGpu() {
  // Apple Silicon: unified memory + Metal is always available to llama.cpp.
  if (process.platform === "darwin" && process.arch === "arm64") {
    return { kind: "metal", vramGB: null };
  }
  // NVIDIA: nvidia-smi reports total VRAM in MiB when a driver is present.
  try {
    const out = execFileSync(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", timeout: 3000 }
    );
    const mib = parseInt(out.split("\n")[0].trim(), 10);
    if (Number.isFinite(mib) && mib > 0) return { kind: "cuda", vramGB: mib / 1024 };
  } catch {
    // no nvidia-smi / no NVIDIA GPU
  }
  return { kind: "cpu", vramGB: 0 };
}

// One-line human summary for the wizard header.
export function describeSystem(sys) {
  const ram = `${sys.totalGB.toFixed(1)}GB RAM`;
  const cpu = `${sys.cpus} CPU cores`;
  let gpu;
  if (sys.gpu.kind === "metal") gpu = "Apple GPU (Metal)";
  else if (sys.gpu.kind === "cuda") gpu = `NVIDIA GPU (${sys.gpu.vramGB.toFixed(1)}GB VRAM)`;
  else gpu = "no GPU detected";
  return `${ram} · ${cpu} · ${gpu}`;
}
