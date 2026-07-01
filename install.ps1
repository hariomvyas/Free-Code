# Free Code installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/hariomvyas/Free-Code/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo  = "https://github.com/hariomvyas/Free-Code.git"
$dir   = if ($env:FREECODE_DIR) { $env:FREECODE_DIR } else { Join-Path $HOME ".freecode-app" }
$model = if ($env:FREECODE_MODEL) { $env:FREECODE_MODEL } else { "qwen2.5-coder:3b" }

Write-Host "==> Installing Free Code"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "!! Node.js 18+ is required. Install from https://nodejs.org and re-run." -ForegroundColor Yellow
  return
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host "!! git is required. Install git and re-run." -ForegroundColor Yellow
  return
}

if (Test-Path (Join-Path $dir ".git")) {
  Write-Host "==> Updating existing install in $dir"
  git -C $dir pull --ff-only
} else {
  Write-Host "==> Cloning into $dir"
  git clone --depth 1 $repo $dir
}

Set-Location $dir
Write-Host "==> Linking the 'fcode' command"
npm link

if (Get-Command ollama -ErrorAction SilentlyContinue) {
  Write-Host "==> Pulling model $model (this can take a few minutes)"
  try { ollama pull $model } catch { Write-Host "   (model pull failed — run 'ollama pull $model' later)" -ForegroundColor Yellow }
} else {
  Write-Host "!! Ollama not found. Install from https://ollama.com, then run: ollama pull $model" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==> Done. Start it with:  fcode" -ForegroundColor Green
Write-Host "    Free Code auto-updates itself on future launches."
