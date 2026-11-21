# Thunder Look — Wtyczka Obsidian

**Autor:** Piotr Świerk  
**ID wtyczki:** `thunder-look` (`isDesktopOnly: true`)

Desktopowa wtyczka pocztowa i menedżer projektów dla Obsidian: nieinwazyjny klient IMAP/SMTP (`EXAMINE` + `BODY.PEEK[]`), wsparcie dla **Roundcube (własny serwer/domena np. `trinitec.pl`)**, **Gmail (OAuth2 w przeglądarce + Hasło aplikacji)** oraz **Outlook / Office 365**.

---

## Kluczowe funkcje

- **Kreator szybkiej konfiguracji i 3-etapowa diagnostyka** (IMAP + SMTP + zapisywalność folderu w sejfie).
- **Bezpieczne przechowywanie haseł i tokenów:** `app.secretStorage` → Electron `safeStorage` → lokalne szyfrowanie AES-256-GCM (poza `data.json` i chmurą).
- **Ścisły tryb Opt-in, wątkowanie i deduplikacja:** zapisywanie wyłącznie wskazanych maili, fragmentów lub załączników; frontmatter zawiera `message_id`, `in_reply_to`, `thread_id` i `content_hash`; automatyczne wykrywanie duplikatów i linkowanie wątków (`## Powiązane w wątku`).
- **Bezpieczne załączniki:** ostrzeganie i domyślne odznaczanie niebezpiecznych rozszerzeń (`.exe`, `.bat`, `.ps1`, `.js`, `.msi`, `.iso` itd.), konfigurowalny limit rozmiaru oraz deduplikacja po **SHA-256**.
- **Ochrona przed XSS i tracking pixelami:** sanityzacja DOMPurify + `<iframe sandbox="">` z domyślną blokadą zdalnych obrazów (CSP `img-src 'none'`) oraz przyciskiem ręcznego doładowania obrazów.
- **Odpowiadanie i wysyłka:** Odpowiedz / Odpowiedz wszystkim / Przekaż dalej, konfigurowalna stopka oraz **5-sekundowe „Cofnij wysyłkę”**.
- **Pasek statusu i tryb Offline:** licznik nieprzeczytanych + ostatnia synchronizacja + odczyt z lokalnego cache IndexedDB bez dostępu do sieci.

---

## Instalacja w 30 sekund

### Windows (PowerShell)
```powershell
.\scripts\install-to-vault.ps1
```
Dodatkowe parametry:
- `.\scripts\install-to-vault.ps1 -VaultPath "C:\Sciezka\Do\Sejfu"` — instalacja bez okna wyboru folderu,
- `.\scripts\install-to-vault.ps1 -CreateHotReload` — tworzy plik `.hotreload` do pracy developerskiej.

### Ręcznie (Windows / macOS / Linux)
Skopiuj pliki `main.js`, `manifest.json` oraz `styles.css` do `<TwójSejf>/.obsidian/plugins/thunder-look/`, odśwież listę wtyczek w Obsidian i włącz **Thunder Look**.

---

## Kompilacja ze źródeł

```bash
npm install
npm run typecheck
npm run build
```

Na Windows z sejfem w OneDrive/Google Drive zalecany jest skrypt budujący poza chmurą:
```powershell
.\scripts\build.ps1
```

---

## Test dymny po instalacji w Obsidian

1. Włącz wtyczkę **Thunder Look** i otwórz konsolę deweloperską (`Ctrl+Shift+I` / `Cmd+Opt+I`) — upewnij się, że brak błędów przy starcie.
2. W **Ustawienia → Thunder Look** wybierz preset (np. Roundcube z serwerem `trinitec.pl` lub Gmail) i kliknij **Przetestuj pełną konfigurację**.
3. Otwórz widok poczty z paska bocznego, sprawdź podgląd HTML z blokadą zdalnych obrazów oraz zapis Opt-in do projektu (`SaveEmailModal`).
