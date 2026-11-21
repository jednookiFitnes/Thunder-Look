<#
.SYNOPSIS
  Instaluje skompilowaną wtyczkę Thunder Look (autor: Piotr Świerk) we wskazanym sejfie Obsidian.
.DESCRIPTION
  Kopiuje WYŁĄCZNIE zweryfikowane artefakty (main.js, manifest.json, styles.css) do podfolderu
  .obsidian\plugins\thunder-look\ wybranego sejfu.
  Nigdy nie modyfikuje globalnych plików konfiguracyjnych .obsidian\.
.EXAMPLE
  .\install-to-vault.ps1
  .\install-to-vault.ps1 -VaultPath "C:\Users\Piotr\OneDrive\Praca Vault" -CreateHotReload
#>
param(
  [string]$VaultPath = "",
  [switch]$CreateHotReload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$PluginId = "thunder-look"
$SourceDir = $PSScriptRoot
$ChildPluginDir = Join-Path $PSScriptRoot $PluginId
$ParentDir = Split-Path -Parent $PSScriptRoot

if (Test-Path -LiteralPath (Join-Path $SourceDir "main.js")) {
  # main.js obok skryptu
} elseif (Test-Path -LiteralPath (Join-Path $ChildPluginDir "main.js")) {
  $SourceDir = $ChildPluginDir
} elseif (Test-Path -LiteralPath (Join-Path $ParentDir "main.js")) {
  $SourceDir = $ParentDir
} else {
  Write-Error "Nie znaleziono skompilowanego pliku main.js obok skryptu ani w podfolderze '$PluginId'. Uruchom najpierw 'npm run build' w obsidian-plugin/."
  exit 1
}

# Weryfikacja kompletności paczki przed instalacją
$RequiredFiles = @("main.js", "manifest.json", "styles.css")
foreach ($reqFile in $RequiredFiles) {
  $fullReq = Join-Path $SourceDir $reqFile
  if (-not (Test-Path -LiteralPath $fullReq)) {
    Write-Error "Brak wymaganego pliku wtyczki: `"$fullReq`". Przebuduj projekt."
    exit 1
  }
}

if ([string]::IsNullOrWhiteSpace($VaultPath)) {
  if ($env:OBSIDIAN_VAULT_PATH) {
    $VaultPath = $env:OBSIDIAN_VAULT_PATH
  } else {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Wybierz główny folder swojego sejfu Obsidian (np. w OneDrive)"
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
      Write-Host "Anulowano instalację." -ForegroundColor Yellow
      exit 0
    }
    $VaultPath = $dialog.SelectedPath
  }
}

if (-not (Test-Path -LiteralPath $VaultPath)) {
  Write-Error "Wskazana ścieżka sejfu nie istnieje: `"$VaultPath`""
  exit 1
}

$TargetDir = Join-Path (Join-Path (Join-Path $VaultPath ".obsidian") "plugins") $PluginId
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

foreach ($file in $RequiredFiles) {
  $src = Join-Path $SourceDir $file
  $dst = Join-Path $TargetDir $file
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Write-Host "Skopiowano: $file" -ForegroundColor Green
}

if ($CreateHotReload) {
  $hotReloadFile = Join-Path $TargetDir ".hotreload"
  Set-Content -LiteralPath $hotReloadFile -Value "" -Encoding UTF8
  Write-Host "Utworzono znacznik .hotreload (dla wtyczki Hot-Reload)." -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Gotowe! Zainstalowano Thunder Look (autor: Piotr Świerk) w:" -ForegroundColor Cyan
Write-Host "  `"$TargetDir`""
Write-Host "Następny krok: w Obsidianie wejdź w Ustawienia -> Wtyczki społeczności -> Odśwież listę -> Włącz 'Thunder Look'."
