# Trinitec Mail & Project Manager — Wtyczka Obsidian

Wtyczka desktopowa do Obsidian zaprojektowana dla sejfu inżynierskiego **Praca Vault** (obsługa IMAP/SMTP `roundcube.pl`, analiza zajętości skrzynki, ścisły zapis Opt-in do folderów projektów `11 - Notes - Trinitec Projekty/`, przeglądarka `.eml` oraz integracja z agentami AI przez MCP/CLI bez kluczy API).

## Szybka instalacja w sejfie (np. w OneDrive) — bez kompilacji

1. Pobierz gotowy pakiet ZIP z portalu dystrybucyjnego.
2. W Obsidianie wejdź w **Ustawienia → Wtyczki społeczności → Zainstalowane wtyczki** i kliknij ikonę folderu (otworzy katalog `.obsidian/plugins/` Twojego sejfu).
3. Skopiuj folder `trinitec-mail-project-manager` (zawierający `main.js`, `manifest.json`, `styles.css`) — **albo** uruchom dołączony skrypt `scripts/install-to-vault.ps1`, który zapyta Cię o folder sejfu w oknie Windows.
4. Kliknij **Odśwież** w Obsidianie i włącz wtyczkę **Trinitec Mail & Project Manager**.

## Budowanie ze źródeł (opcjonalne)

W katalogu `obsidian-plugin/`:

```powershell
# Ustawienie długich ścieżek na Windows (OneDrive)
git config --global core.longpaths true

# Instalacja zależności i budowanie
pnpm install
pnpm run build
```

Lub użyj `.\scripts\build.ps1` (kompiluje w lokalnym buforze `%USERPROFILE%\.obsidian-builds\`, omijając blokady synchronizacji OneDrive). Opcjonalnie ustaw zmienną środowiskową `OBSIDIAN_VAULT_PATH`, jeśli chcesz automatycznie kopiować `main.js` po buildzie.

## Kluczowe zasady bezpieczeństwa i ergonomii

- **Hasło poczty** przechowywane jest wyłącznie lokalnie (`app.secretStorage` / `localStorage`), nigdy w `data.json` synchronizowanym w OneDrive.
- **Ścisły zapis Opt-in**: wtyczka nigdy nie zapisuje automatycznie całej poczty — zapisujesz tylko jawnie wskazany mail, zaznaczony fragment tekstu lub wybrane załączniki.
- **Nieinwazyjny IMAP (`EXAMINE` / `BODY.PEEK[]`)**: skanowanie folderów i rozmiaru skrzynki nie zmienia statusu przeczytania wiadomości.
- **Zgodność z `AGENTS.md`**: CRLF-safe zapis przez `app.vault.process()`, aktualizacje YAML przez `app.fileManager.processFrontMatter()`, izolacja CSS `.trinitec-mail-*`, brak `detachLeavesOfType()` w `onunload()`.
