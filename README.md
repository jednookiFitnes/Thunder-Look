# Thunder Look — Klient Poczty IMAP/SMTP i Menedżer Projektów dla Obsidian

**Autor:** Piotr Świerk  
**Wtyczka Obsidian (`thunder-look`) · Wspólny rdzeń (`shared/`) · Serwer MCP & CLI (`mcp-cli/`) · Portal instalacyjny**

Thunder Look łączy skrzynki **Roundcube / własne domeny (np. `trinitec.pl`)**, **Gmail (logowanie przez przeglądarkę Google OAuth2 lub Hasło aplikacji)** oraz **Outlook / Office 365** z Twoim sejfem Obsidian — bez żadnych kluczy API LLM, z twardym trybem **Opt-in** i pełnym zabezpieczeniem haseł poza synchronizacją chmurową.

---

## Architektura repozytorium

- `shared/` — wspólna warstwa bezstanowa (sanityzacja HTML + blokada trackerów CSP, ochrona przed Path Traversal i nazwami Windows/Obsidian, walidacja nagłówków SMTP i SSRF, parser domeny Roundcube, wątkowanie RFC 5322, izolacja Prompt Injection).
- `obsidian-plugin/` — gotowa wtyczka desktopowa Obsidian (`isDesktopOnly: true`), zminifikowany pakiet produkcyjny `main.js`, motywy `.tl-*` oparte o zmienne Obsidian oraz skrypty Windows PowerShell (`scripts/build.ps1`, `scripts/install-to-vault.ps1`).
- `mcp-cli/` — serwer **MCP (stdio)** i narzędzie **CLI** (`thunder-look`) dla lokalnych agentów AI w domyślnym trybie **Read-Only** (`ai-policy.example.json`).
- `tests/` — automatyczne testy jednostkowe (Node test runner) dla wszystkich ścieżek bezpieczeństwa i logiki.
- `server.ts` / `src/` — lokalny portal instalacyjny z pobieraniem gotowego ZIP, testem połączenia IMAP i logowaniem do Google w przeglądarce.

---

## Szybki start „za pierwszym razem”

### 1. Instalacja wtyczki w Obsidian (Windows / macOS / Linux)

**Opcja A — Z gotowego archiwum lub lokalnego repozytorium (Windows PowerShell):**
```powershell
cd obsidian-plugin
.\scripts\install-to-vault.ps1
```
Skrypt otworzy okno wyboru katalogu sejfu Obsidian (również w OneDrive / Google Drive) i skopiuje wyłącznie `main.js`, `manifest.json` oraz `styles.css` do `.obsidian/plugins/thunder-look/`.

**Opcja B — Ręcznie w 30 sekund:**
1. Otwórz Obsidian → **Ustawienia → Wtyczki społeczności → Zainstalowane wtyczki** → kliknij ikonę folderu.
2. Utwórz katalog `thunder-look` i skopiuj do niego `obsidian-plugin/main.js`, `manifest.json` oraz `styles.css`.
3. Kliknij **Odśwież** i włącz **Thunder Look**.

### 2. Pierwsza konfiguracja skrzynki w Obsidian

Wejdź w **Ustawienia → Thunder Look** i wybierz preset:
- **Roundcube / własna domena:** wpisz w polu **Serwer / Domena** dokładnie adres z logowania Roundcube (np. `trinitec.pl` lub `mail.trinitec.pl`), podaj login (e-mail) i hasło.
- **Gmail:** kliknij **Zaloguj przez Google (przeglądarka)** (OAuth2 PKCE + XOAUTH2) albo wybierz metodę **Hasło aplikacji Google (16 znaków)**.
- **Outlook / Office 365:** użyj gotowego presetu (`outlook.office365.com:993`, `smtp.office365.com:587`).

Następnie kliknij **Przetestuj pełną konfigurację** — diagnostyka sprawdzi po kolei:
1. Połączenie i logowanie IMAP + liczbę folderów,
2. Połączenie i uwierzytelnienie SMTP,
3. Istnienie i zapisywalność folderu projektów w sejfie.

---

## Komendy developerskie i weryfikacja (monorepo)

```bash
# Uruchomienie wszystkich testów jednostkowych (XSS, Path Traversal, SMTP, wątki, MCP)
npm run test

# Sprawdzenie typów TypeScript (strict: true) we wszystkich 3 modułach
npm run typecheck:all

# Pełny build produkcyjny (wtyczka Obsidian + MCP/CLI + portal)
npm run build:all

# Pełna brama jakości (testy + typecheck + build)
npm run verify

# Uruchomienie lokalnego portalu (domyślnie wyłącznie na 127.0.0.1:3000)
npm run dev
```

---

## Bezpieczeństwo w skrócie

- **Brak sekretów w chmurze:** hasła i tokeny OAuth2 trafiają do `app.secretStorage` → Electron `safeStorage` → zaszyfrowanego pliku per urządzenie (AES-256-GCM) i **nigdy** nie są zapisywane w `data.json`.
- **Ochrona XSS / RCE i tracking pixeli:** treść HTML maili jest sanityzowana (DOMPurify + warstwa `shared/htmlSanitizer`) i renderowana w `<iframe sandbox="">` z CSP `script-src 'none'; img-src 'none'`.
- **Bezpieczny serwer lokalny:** `server.ts` domyślnie nasłuchuje wyłącznie na `127.0.0.1`, zabezpiecza `/api/*` losowym tokenem Bearer generowanym przy starcie, stosuje limit 10 prób/min na `/api/imap/test` oraz blokuje SSRF i porty inne niż `143`/`993`.
- **Bezpieczne MCP:** domyślna polityka Read-Only (`ai-policy.example.json`), wymagana flaga `userExplicitlyConfirmed: true` przy operacjach zapisu oraz izolacja treści maili w `<untrusted_email_content>`.

---

## Rozwiązywanie typowych problemów

| Objaw | Przyczyna i rozwiązanie |
| --- | --- |
| `ENOTFOUND` dla domeny Roundcube | Spróbuj wpisać `mail.<domena>` lub `imap.<domena>` w polu **Serwer / Domena**. |
| Gmail odrzuca logowanie hasłem | Użyj przycisku **Zaloguj przez Google (przeglądarka)** lub wygeneruj 16-znakowe **Hasło aplikacji** po włączeniu 2FA w koncie Google. |
| Błąd certyfikatu TLS (`self signed` / `hostname mismatch`) | Użyj dokładnej nazwy hosta z certyfikatu serwera (np. `mail.trinitec.pl`). Wyłączaj ścisłą weryfikację TLS wyłącznie w zaufanej sieci. |
| Blokada plików w OneDrive / Google Drive | Uruchamiaj build przez `obsidian-plugin/scripts/build.ps1` (buduje poza chmurą w `%USERPROFILE%\.obsidian-builds\`). |
