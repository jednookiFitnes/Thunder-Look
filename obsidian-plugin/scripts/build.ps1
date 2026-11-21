<#
.SYNOPSIS
  Buduje wtyczkę Thunder Look (autor: Piotr Świerk) w lokalnym buforze poza chmurą (OneDrive / Google Drive),
  aby uniknąć blokad I/O (EBUSY / EPERM).
.EXAMPLE
  .\build.ps1
  .\build.ps1 -VaultPath "C:\Users\Piotr\OneDrive\Praca Vault" -CreateHotReload
#>
param(
  [string]$VaultPath = $env:OBSIDIAN_VAULT_PATH,
  [switch]$CreateHotReload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PluginId = "thunder-look"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RepoRoot = Split-Path -Parent $ProjectRoot
$LocalBuildRoot = Join-Path $env:USERPROFILE ".obsidian-builds\$PluginId-workspace"
$LocalPluginDir = Join-Path $LocalBuildRoot "obsidian-plugin"
$LocalSharedDir = Join-Path $LocalBuildRoot "shared"

New-Item -ItemType Directory -Force -Path $LocalPluginDir | Out-Null
New-Item -ItemType Directory -Force -Path $LocalSharedDir | Out-Null

Write-Host "Synchronizacja źródeł (obsidian-plugin + shared) do lokalnego bufora: `"$LocalBuildRoot`"" -ForegroundColor Cyan

# Robocopy zwraca kody 0-7 dla sukcesu
$rc1 = Start-Process -FilePath "robocopy" -ArgumentList "`"$ProjectRoot`" `"$LocalPluginDir`" /MIR /XD node_modules .git dist /XF data.json .env *.log" -NoNewWindow -Wait -PassThru
if ($rc1.ExitCode -ge 8) {
  throw "Błąd robocopy dla obsidian-plugin (kod wyjścia: $($rc1.ExitCode))."
}

$SharedSource = Join-Path $RepoRoot "shared"
if (Test-Path -LiteralPath $SharedSource) {
  $rc2 = Start-Process -FilePath "robocopy" -ArgumentList "`"$SharedSource`" `"$LocalSharedDir`" /MIR /XD node_modules .git" -NoNewWindow -Wait -PassThru
  if ($rc2.ExitCode -ge 8) {
    throw "Błąd robocopy dla shared (kod wyjścia: $($rc2.ExitCode))."
  }
}

Push-Location -LiteralPath $LocalPluginDir
try {
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    & pnpm install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) { & pnpm install }
    if ($LASTEXITCODE -ne 0) { throw "pnpm install zakończył się błędem." }
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "pnpm run build zakończył się błędem." }
  } else {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install zakończył się błędem." }
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build zakończył się błędem." }
  }
} finally {
  Pop-Location
}

# Weryfikacja i kopiowanie artefaktów produkcyjnych z powrotem do projektu
$RequiredArtifacts = @("main.js", "manifest.json", "styles.css")
foreach ($file in $RequiredArtifacts) {
  $built = Join-Path $LocalPluginDir $file
  if (-not (Test-Path -LiteralPath $built)) {
    throw "Brak wymaganego artefaktu po kompilacji: `"$file`""
  }
  Copy-Item -LiteralPath $built -Destination (Join-Path $ProjectRoot $file) -Force
}

$mainSizeKb = [Math]::Round((Get-Item -LiteralPath (Join-Path $ProjectRoot "main.js")).Length / 1KB, 1)
Write-Host "Zbudowano Thunder Look pomyślnie (main.js: $mainSizeKb KB)." -ForegroundColor Green

if (-not [string]::IsNullOrWhiteSpace($VaultPath)) {
  & (Join-Path $PSScriptRoot "install-to-vault.ps1") -VaultPath $VaultPath -CreateHotReload:$CreateHotReload
} else {
  Write-Host "Aby zainstalować w sejfie, uruchom install-to-vault.ps1 lub ustaw OBSIDIAN_VAULT_PATH." -ForegroundColor Yellow
}
