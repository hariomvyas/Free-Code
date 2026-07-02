import { httpJson } from "./download.js";

// We bundle prebuilt llama.cpp binaries from the upstream GitHub releases rather
// than asking the user to install anything. Asset names change between releases,
// so instead of hardcoding a build number we query the latest release and match
// the right asset by pattern for this platform + acceleration variant.
const RELEASES_API = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";

export function serverBinName() {
  return process.platform === "win32" ? "llama-server.exe" : "llama-server";
}

// Default acceleration variant for the host. macOS arm64 ships Metal in the
// standard build; everywhere else we default to the CPU build because it always
// runs (no CUDA/Vulkan runtime required). Users can opt into a GPU build via
// FREECODE_ENGINE_VARIANT=cuda|vulkan.
export function defaultVariant(sys) {
  if (process.platform === "darwin") return "metal";
  const env = process.env.FREECODE_ENGINE_VARIANT;
  if (env) return env;
  return "cpu";
}

// Regex that matches the correct release asset zip for this platform + variant.
export function assetPattern(variant) {
  const { platform, arch } = process;
  if (platform === "darwin") {
    return arch === "arm64" ? /bin-macos-arm64\.zip$/ : /bin-macos-x64\.zip$/;
  }
  if (platform === "win32") {
    if (variant === "cuda") return /bin-win-cuda.*x64\.zip$/;
    if (variant === "vulkan") return /bin-win-vulkan-x64\.zip$/;
    return /bin-win-cpu-x64\.zip$/;
  }
  // linux
  if (variant === "vulkan") return /bin-ubuntu-vulkan-x64\.zip$/;
  return /bin-ubuntu-x64\.zip$/;
}

// Resolve the concrete asset { url, name, tag } to download for `variant`.
export async function resolveEngineAsset(variant) {
  const rel = await httpJson(RELEASES_API, {
    headers: { "User-Agent": "free-code", Accept: "application/vnd.github+json" },
  });
  const pat = assetPattern(variant);
  const asset = (rel.assets || []).find((a) => pat.test(a.name));
  if (!asset) {
    throw new Error(
      `No llama.cpp asset matching ${pat} in release ${rel.tag_name}. ` +
        `Set FREECODE_ENGINE_VARIANT or report this.`
    );
  }
  return { url: asset.browser_download_url, name: asset.name, tag: rel.tag_name };
}
