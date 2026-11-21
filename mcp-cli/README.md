# Trinitec Mail — Serwer MCP (stdio) i narzędzie CLI

Moduł integracji z zewnętrznymi agentami AI (np. **Antigravity**, Claude Desktop, Cursor) działający **całkowicie bez kluczy API LLM**. Agent korzysta z lokalnego serwera MCP (`dist/mcpServer.js`) lub komend CLI (`dist/cli.js`), a wszystkie akcje zapisu i przenoszenia podlegają bezpiecznej polityce w `trinitec-ai-policy.json`.

## Konfiguracja

1. Skopiuj `.env.example` jako `.env` i uzupełnij:
   - `OBSIDIAN_VAULT_PATH` — pełna ścieżka do Twojego sejfu Obsidian (np. w OneDrive)
   - `IMAP_HOST`, `SMTP_HOST`, `MAIL_USER`, `MAIL_PASSWORD` (np. dla `roundcube.pl`)
2. W `trinitec-ai-policy.json` skonfiguruj:
   - Aktywne typy analiz (`categorization`, `folderRouting`, `taskExtraction`, `prioritization`) oraz tryb (`"suggest"` lub `"auto"`).
   - Flagi bezpieczeństwa (`allowImapMove`, `allowSmtpSend`, `allowVaultWrite`, `optInVaultSavingOnly`). Domyślnie aktywny jest bezpieczny tryb **Read-Only**.

## Uruchomienie MCP (Antigravity)

Dodaj w konfiguracji MCP klienta desktopowego:

```json
{
  "mcpServers": {
    "trinitec-mail": {
      "command": "node",
      "args": ["<SCIEZKA_DO_FOLDERU>/mcp-cli/dist/mcpServer.js"],
      "env": {
        "OBSIDIAN_VAULT_PATH": "<SCIEZKA_DO_TWOJEGO_SEJFU_ONEDRIVE>"
      }
    }
  }
}
```

## Przykłady CLI

```bash
node dist/cli.js quota --top 15
node dist/cli.js list --folder INBOX --limit 20 --unseen
node dist/cli.js read 1042 --folder INBOX
node dist/cli.js triage --folder INBOX --limit 10
node dist/cli.js projects
```
