<#
.SYNOPSIS
  Instaluje skompilowaną wtyczkę Trinitec Mail & Project Manager we wskazanym sejfie Obsidian (np. w OneDrive).
.DESCRIPTION
  Kopiuje WYŁĄCZNIE pliki main.js, manifest.json i styles.css do podfolderu
  .obsidian\plugins\trinitec-mail-project-manager\ wybranego sejfu.
  Nigdy nie modyfikuje globalnych plików konfiguracyjnych .obsidian\.
.EXAMPLE
  .\install-to-vault.ps1
  .\install-to-vault.ps1 -VaultPath "C:\Users\Piotr\OneDrive\Praca Vault"
#>
param(
  [string]$VaultPath = ""
)

$ErrorActionPreference = "Stop"
$PluginId = "trinitec-mail-project-manager"

# Wykryj katalog źródłowy z main.js (katalog skryptu, podfolder wtyczki w paczce ZIP lub katalog nadrzędny repo)
$SourceDir = $PSScriptRoot
$ChildPluginDir = Join-Path $PSScriptRoot $PluginId
$ParentDir = Split-Path -Parent $PSScriptRoot

if (Test-Path (Join-Path $SourceDir "main.js")) {
  # main.js obok skryptu
} elseif (Test-Path (Join-Path $ChildPluginDir "main.js")) {
  $SourceDir = $ChildPluginDir
} elseif (Test-Path (Join-Path $ParentDir "main.js")) {
  $SourceDir = $ParentDir
} else {
  Write-Error "Nie znaleziono skompilowanego pliku main.js obok skryptu ani w podfolderze '$PluginId'. Uruchom najpierw 'pnpm run build' lub pobierz gotową paczkę ZIP."
  exit 1
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

if (-not (Test-Path $VaultPath)) {
  Write-Error "Wskazana ścieżka sejfu nie istnieje: `"$VaultPath`""
  exit 1
}

$TargetDir = Join-Path (Join-Path (Join-Path $VaultPath ".obsidian") "plugins") $PluginId
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

foreach ($file in @("main.js", "manifest.json", "styles.css")) {
  $src = Join-Path $SourceDir $file
  if (Test-Path $src) {
    Copy-Item -Path $src -Destination (Join-Path $TargetDir $file) -Force
    Write-Host "Skopiowano: $file" -ForegroundColor Green
  }
}

Write-Host ""
Write-Host "Gotowe! Zainstalowano wtyczkę w:" -ForegroundColor Cyan
Write-Host "  `"$TargetDir`""
Write-Host "Następny krok: w Obsidianie wejdź w Ustawienia -> Wtyczki społeczności -> Odśwież listę -> Włącz 'Trinitec Mail & Project Manager'."
