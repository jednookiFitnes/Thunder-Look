# Thunder Look — Wtyczka Obsidian

**Autor:** Piotr Świerk  
**ID wtyczki:** `thunder-look` (`isDesktopOnly: true`)

Pełny desktopowy klient poczty IMAP/SMTP i menedżer projektów dla Obsidian: obsługa wielu kont (**Roundcube / własna domena**, **Gmail OAuth2 lub Hasło aplikacji**, **Outlook / Office 365**), wspólna skrzynka odbiorcza (**Unified Inbox**), stałe połączenie IMAP z paginacją i cache L1/L2, nowoczesny układ 3-kolumnowy lub klasyczny z przeciąganymi separatorami oraz bezpieczny zapis Opt-in do Vaulta.

---

## Kluczowe funkcje

- **Wydajność klasy desktopowej:** stały menedżer sesji IMAP (kolejka operacji, keep-alive `NOOP`, auto-reconnect), paginacja po 50 nagłówków, leniwe dociąganie pełnej treści i załączników (`partId`), prefetch 2 sąsiednich maili oraz 2-warstwowy cache RAM (L1) + IndexedDB (L2) ze wzorcem stale-while-revalidate.
- **Wiele kont + Wspólna skrzynka (Unified Inbox):** konfiguracja wielu skrzynek z etykietami i kolorami, osobnymi hasłami w `electron.safeStorage`, szybkim przełącznikiem w panelu folderów i automatycznym doborem nadawcy `Od:` przy odpowiedzi.
- **Nowoczesny interfejs i czysty podgląd HTML:** 3 kolumny lub układ klasyczny góra-dół, przeciągane uchwyty szerokości kolumn, czysty reset tabel newsletterów wewnątrz `<iframe sandbox="">` (brak obcych ramek wokół komórek), przełącznik **Jasny / Ciemny / Markdown** oraz zaufani nadawcy dla obrazów zdalnych.
- **Pełne zarządzanie wiadomościami i folderami:** Usuń do Kosza, Usuń trwale, Przywróć, Opróżnij Kosz/Spam, Archiwizuj, Spam, 5-sekundowe **Cofnij**, flagi `\Seen` / `\Flagged` (z opcjonalnym opóźnieniem automatycznego oznaczania jako przeczytane), Przenieś do folderu, **Drag & Drop** na drzewko folderów, menu kontekstowe, zaznaczanie zbiorcze (`Shift+Click` / `Ctrl+Click`) oraz tworzenie/zmiana nazwy/usuwanie folderów IMAP z ochroną folderów systemowych.
- **Wyszukiwanie, Wątki, Załączniki, Szkice i Skróty:** serwerowe `IMAP SEARCH` (i `X-GM-RAW` dla Gmaila) z operatorami (`from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `before:`, `after:`), Widok wątków (Conversation View), podgląd obrazów i PDF w Obsidian, wklejanie zrzutów ekranu (`Ctrl+V`), szablony odpowiedzi z Vaulta, szkice synchronizowane przez IMAP (autozapis co 15 s) oraz skróty klawiszowe (`J/K`, `E`, `R`, `A`, `F`, `C`, `S`, `U`, `/`, `Delete`, `?`).
- **Niezawodne powiadomienia IDLE i Reguły pocztowe:** wielokontowy `IMAP IDLE` (RFC 2177 z odnawianiem co 14 min i detekcją wybudzenia), opcjonalne powiadomienia systemowe OS z otwieraniem maila po kliknięciu oraz klienckie reguły automatyczne (gwiazdka / przeczytane / przeniesienie do folderu).
- **Dokładny Monitor zajętości skrzynki:** poprawna normalizacja jednostek `GETQUOTAROOT`, uwzględnienie `[Gmail]/Wszystkie` w sumie wiadomości oraz deduplikacja największych wiadomości po `Message-ID`.

---

## Instalacja w 30 sekund

Szczegółowa instrukcja znajduje się także w pliku `INSTRUKCJA-INSTALACJI.txt`.

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
