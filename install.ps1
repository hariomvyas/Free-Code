# Free Code installer for Windows (PowerShell).
#   irm https://raw.githubusercontent.com/hariomvyas/Free-Code/main/install.ps1 | iex
$ErrorActionPreference = "Stop"

$repo  = "https://github.com/hariomvyas/Free-Code.git"
$dir   = if ($env:FREECODE_DIR) { $env:FREECODE_DIR } else { Join-Path $HOME ".freecode-app" }

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

Write-Host ""
Write-Host "==> Done. Start it with:  fcode" -ForegroundColor Green
Write-Host "    On first launch, Free Code analyzes your machine, offers 3 model options,"
Write-Host "    and downloads the one you pick (plus its local engine) - no Ollama needed."
Write-Host "    It also auto-updates itself on future launches."
