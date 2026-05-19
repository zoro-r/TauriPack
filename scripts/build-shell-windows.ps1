$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$UiDir = Join-Path $RootDir "apps/packer-ui"
$TauriDir = Join-Path $RootDir "apps/packer-core/src-tauri"
$OutDir = Join-Path $RootDir "templates/windows"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Push-Location $UiDir
pnpm run build
Pop-Location

Push-Location $TauriDir
cargo tauri build
Pop-Location

$ExePath = Join-Path $TauriDir "target/release/packer-core.exe"
if (-not (Test-Path $ExePath)) {
  throw "Build output not found: $ExePath"
}

Copy-Item -Force $ExePath (Join-Path $OutDir "base.exe")

Write-Host "Shell exe exported to: $OutDir\base.exe"
