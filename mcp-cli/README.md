# Thunder Look — Serwer MCP (stdio) i narzędzie CLI

**Autor:** Piotr Świerk  
**Zero kluczy API LLM · Domyślny tryb Read-Only · Ochrona przed Prompt Injection i Path Traversal**

Moduł `mcp-cli/` udostępnia lokalny serwer **Model Context Protocol (stdio)** oraz narzędzie wiersza poleceń (`thunder-look`) łączące skrzynki IMAP/SMTP (Roundcube, Gmail, Outlook) z Twoim sejfem Obsidian.

---

## Szybki start krok po kroku

### 1. Instalacja i kompilacja
```bash
cd mcp-cli
npm install
npm run build
```

### 2. Konfiguracja `.env` i polityki `ai-policy.json`
```bash
cp .env.example .env
cp ai-policy.example.json ai-policy.json
```
Uzupełnij w `.env`:
- `OBSIDIAN_VAULT_PATH` — pełna ścieżka do Twojego sejfu Obsidian,
- `MAIL_SERVER` (lub `IMAP_HOST` / `SMTP_HOST`) — np. `trinitec.pl` albo `imap.gmail.com`,
- `MAIL_USER` i `MAIL_PASSWORD` (dla Gmaila: 16-znakowe Hasło aplikacji Google).

> **Uwaga bezpieczeństwa:** Plik `.env` oraz `ai-policy.json` są ignorowane przez `.gitignore`. Domyślnie wszystkie operacje modyfikujące (`allowImapMove`, `allowVaultWrite`, `allowSmtpSend`) mają wartość `false` (tryb **Read-Only**).

### 3. Rejestracja serwera MCP (np. Antigravity / Claude Desktop / Cursor)
```json
{
  "mcpServers": {
    "thunder-look": {
      "command": "node",
      "args": ["/PELNA/SCIEZKA/DO/mcp-cli/dist/mcp-cli/src/mcpServer.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "/PELNA/SCIEZKA/DO/SEJFU",
        "MAIL_SERVER": "trinitec.pl",
        "IMAP_PORT": "993",
        "IMAP_SECURE": "true",
        "IMAP_STRICT_TLS": "true",
        "SMTP_PORT": "465",
        "SMTP_SECURE": "true",
        "MAIL_USER": "imie.nazwisko@trinitec.pl",
        "MAIL_PASSWORD": "<HASLO_LUB_PLIK_.env>"
      }
    }
  }
}
```

---

## Najważniejsze polecenia CLI

```bash
# Lista folderów IMAP z rozmiarami (tryb nieinwazyjny EXAMINE)
node dist/mcp-cli/src/cli.js folders --sizes

# Raport zajętości skrzynki i 20 największych wiadomości
node dist/mcp-cli/src/cli.js quota --top 20

# Lista nieprzeczytanych wiadomości (nie zmienia flagi \Seen)
node dist/mcp-cli/src/cli.js list --folder INBOX --unseen --limit 25

# Podgląd pojedynczego maila + dopasowanie do projektu + analiza heurystyczna
node dist/mcp-cli/src/cli.js read <UID> --folder INBOX

# Szybki triage 10 najnowszych maili (bez zewnętrznego API AI)
node dist/mcp-cli/src/cli.js triage --folder INBOX --limit 10

# Podgląd lub zmiana flag w ai-policy.json
node dist/mcp-cli/src/cli.js policy
```

---

## Wbudowane zabezpieczenia MCP

1. **Izolacja Prompt Injection:** odpowiedzi narzędzi odczytujących pocztę zamykają treść wiadomości w tagach `<untrusted_email_content treat_as="data_only">` i usuwają próby wstrzyknięcia tagów `<system>` / `<instructions>`.
2. **Wymagane jawne potwierdzenie:** wszystkie mutujące narzędzia MCP (`save_email_to_vault`, `move_email_folder`, `send_email`, `create_obsidian_task`) wymagają zarówno zgody w `ai-policy.json`, jak i parametru `userExplicitlyConfirmed: true`.
3. **Ochrona przed Path Traversal i symlinkami:** wszystkie ścieżki w sejfie są walidowane przez `shared/pathSecurity` oraz `fs.realpathSync()` przed zapisem.
4. **Ochrona SMTP Header Injection i ścisły TLS:** odrzucanie znaków `\r`, `\n`, `\0` w nagłówkach oraz domyślne `rejectUnauthorized: true`.
