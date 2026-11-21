<#
.SYNOPSIS
  Buduje wtyczkę w lokalnym buforze poza chmurą (OneDrive / Google Drive), aby uniknąć blokad I/O (EBUSY / EPERM).
#>
param(
  [string]$VaultPath = $env:OBSIDIAN_VAULT_PATH
)

$ErrorActionPreference = "Stop"
$PluginId = "trinitec-mail-project-manager"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LocalBuildDir = Join-Path $env:USERPROFILE ".obsidian-builds\$PluginId"

New-Item -ItemType Directory -Force -Path $LocalBuildDir | Out-Null

Write-Host "Synchronizacja źródeł do lokalnego bufora: `"$LocalBuildDir`"" -ForegroundColor Cyan
robocopy "$ProjectRoot" "$LocalBuildDir" /MIR /XD node_modules .git dist /XF data.json .env *.log | Out-Null

Push-Location $LocalBuildDir
try {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm install --frozen-lockfile 2>$null; if ($LASTEXITCODE -ne 0) { pnpm install }
    pnpm run build
  } else {
    npm install
    npm run build
  }
} finally {
  Pop-Location
}

# Kopiowanie zbudowanych artefaktów z powrotem do projektu
foreach ($file in @("main.js", "manifest.json", "styles.css")) {
  $built = Join-Path $LocalBuildDir $file
  if (Test-Path $built) {
    Copy-Item -Path $built -Destination (Join-Path $ProjectRoot $file) -Force
  }
}

# Opcjonalna instalacja w sejfie, jeśli podano OBSIDIAN_VAULT_PATH lub parametr -VaultPath
if (-not [string]::IsNullOrWhiteSpace($VaultPath)) {
  & (Join-Path $PSScriptRoot "install-to-vault.ps1") -VaultPath $VaultPath
} else {
  Write-Host "Zbudowano main.js lokalnie. Aby automatycznie kopiować do sejfu, ustaw OBSIDIAN_VAULT_PATH lub uruchom install-to-vault.ps1." -ForegroundColor Green
}
