import { App, PluginSettingTab, Setting } from "obsidian";
import { AiApplyMode, SaveDestinationMode } from "./types";
import { CategoryRuleModal } from "./modals/CategoryRuleModal";
import { EmailSettingsSection } from "./components/EmailSettingsSection";
import type TrinitecMailPlugin from "./main";

type SettingsSubTab = "general" | "ai" | "help";

export class TrinitecSettingTab extends PluginSettingTab {
  private plugin: TrinitecMailPlugin;
  private activeTab: SettingsSubTab = "general";

  constructor(app: App, plugin: TrinitecMailPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Thunder Look — Autor: Piotr Świerk" });

    const tabsBar = containerEl.createDiv({ cls: "tl-settings-tabs" });
    const tabs: Array<{ id: SettingsSubTab; label: string }> = [
      { id: "general", label: "Poczta IMAP/SMTP i Vault" },
      { id: "ai", label: "Analiza AI (MCP / CLI)" },
      { id: "help", label: "Jak używać" },
    ];

    for (const tab of tabs) {
      const btn = tabsBar.createEl("button", {
        text: tab.label,
        type: "button",
        cls: `tl-settings-tab-btn${this.activeTab === tab.id ? " is-active" : ""}`,
      });
      btn.addEventListener("click", () => {
        this.activeTab = tab.id;
        this.display();
      });
    }

    if (this.activeTab === "general") {
      this.renderGeneralTab(containerEl);
    } else if (this.activeTab === "ai") {
      this.renderAiTab(containerEl);
    } else {
      this.renderHowToUseTab(containerEl);
    }
  }

  private renderGeneralTab(containerEl: HTMLElement): void {
    new EmailSettingsSection(this.plugin, containerEl, () => this.display()).render();

    containerEl.createEl("h3", { text: "Zachowanie klienta poczty i bezpieczeństwo" });

    new Setting(containerEl)
      .setName("Nieinwazyjny podgląd (EXAMINE / BODY.PEEK)")
      .setDesc("Odczyt i skanowanie rozmiaru skrzynki nie oznaczają maili jako przeczytanych na serwerze.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.nonIntrusivePeek).onChange(async (v) => {
          this.plugin.settings.nonIntrusivePeek = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Automatyczna kopia wysłanych w folderze Sent (IMAP APPEND)")
      .setDesc("Dla Gmaila pomijane automatycznie (SMTP Gmaila sam zapisuje kopię w Wysłanych).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.appendSentToImap).onChange(async (v) => {
          this.plugin.settings.appendSentToImap = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Blokuj zdalne obrazy i piksele śledzące w HTML (CSP img-src 'none')")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.blockRemoteImagesByDefault).onChange(async (v) => {
          this.plugin.settings.blockRemoteImagesByDefault = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("IMAP IDLE w tle (powiadomienia push o nowych wiadomościach)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableImapIdle).onChange(async (v) => {
          this.plugin.settings.enableImapIdle = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Maksymalny rozmiar zapisywanego załącznika (MB)")
      .setDesc("Chroni sejf i dysk chmurowy przed przypadkowym zapisaniem wielkich plików (1-250 MB).")
      .addText((t) =>
        t
          .setPlaceholder("25")
          .setValue(String(this.plugin.settings.maxAttachmentSizeMb))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 1 && n <= 250) {
              this.plugin.settings.maxAttachmentSizeMb = Math.floor(n);
              await this.plugin.saveSettings();
            }
          })
      );

    containerEl.createEl("h3", { text: "Struktura Vaulta i polityka Opt-in" });

    new Setting(containerEl)
      .setName("Katalog aktywnych projektów")
      .addText((t) =>
        t.setValue(this.plugin.settings.activeProjectsDir).onChange(async (v) => {
          this.plugin.settings.activeProjectsDir = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Katalog archiwum projektów")
      .addText((t) =>
        t.setValue(this.plugin.settings.archiveProjectsDir).onChange(async (v) => {
          this.plugin.settings.archiveProjectsDir = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Katalog kontaktów")
      .addText((t) =>
        t.setValue(this.plugin.settings.contactsDir).onChange(async (v) => {
          this.plugin.settings.contactsDir = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Folder-kolejka Allowlist w IMAP (opcjonalnie)")
      .setDesc("Folder, do którego możesz ręcznie przenosić maile z telefonu/Roundcube do późniejszego zapisu.")
      .addText((t) =>
        t.setValue(this.plugin.settings.allowlistFolder).onChange(async (v) => {
          this.plugin.settings.allowlistFolder = v.trim();
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Ścisły zapis Opt-in")
      .setDesc("Zapisuje do Vaulta wyłącznie wyraźnie wskazane maile, wycinki tekstu lub załączniki.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.optInStrictMode).onChange(async (v) => {
          this.plugin.settings.optInStrictMode = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Domyślny sposób zapisu")
      .addDropdown((dd) =>
        dd
          .addOption("new-file", "Osobny plik (Mail - RRRR-MM-DD - Temat.md)")
          .addOption("append-note", "Dopisz do istniejącej notatki")
          .setValue(this.plugin.settings.defaultSaveMode)
          .onChange(async (v) => {
            this.plugin.settings.defaultSaveMode = v as SaveDestinationMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Domyślnie oczyszczaj cytaty i stopki (Quote Stripping)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.stripQuotesAndSignatures).onChange(async (v) => {
          this.plugin.settings.stripQuotesAndSignatures = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Domyślnie zapisuj kopię dowodową .eml obok notatki")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.saveRawEmlCopy).onChange(async (v) => {
          this.plugin.settings.saveRawEmlCopy = v;
          await this.plugin.saveSettings();
        })
      );
  }

  private renderAiTab(containerEl: HTMLElement): void {
    containerEl.createEl("h3", {
      text: "Konfiguracja modułu analizy AI (MCP / CLI — zero kluczy API)",
    });

    new Setting(containerEl)
      .setName("1. Kategoryzacja wiadomości (Zlecenie / Pytanie / Raport / Oferta)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.aiCategorizationEnabled).onChange(async (v) => {
          this.plugin.settings.aiCategorizationEnabled = v;
          await this.plugin.saveSettings();
        })
      )
      .addDropdown((dd) =>
        dd
          .addOption("suggest", "Sugeruj")
          .addOption("auto", "Automatycznie")
          .setValue(this.plugin.settings.aiCategorizationMode)
          .onChange(async (v) => {
            this.plugin.settings.aiCategorizationMode = v as AiApplyMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("2. Przenoszenie do folderów (IMAP / Obsidian)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.aiFolderRoutingEnabled).onChange(async (v) => {
          this.plugin.settings.aiFolderRoutingEnabled = v;
          await this.plugin.saveSettings();
        })
      )
      .addDropdown((dd) =>
        dd
          .addOption("suggest", "Sugeruj")
          .addOption("auto", "Automatycznie")
          .setValue(this.plugin.settings.aiFolderRoutingMode)
          .onChange(async (v) => {
            this.plugin.settings.aiFolderRoutingMode = v as AiApplyMode;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("3. Wyodrębnianie zadań Obsidian Tasks (- [ ] Opis 📅 YYYY-MM-DD ⏫)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.aiTaskExtractionEnabled).onChange(async (v) => {
          this.plugin.settings.aiTaskExtractionEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("4. Priorytetyzacja wiadomości i zadań")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.aiPrioritizationEnabled).onChange(async (v) => {
          this.plugin.settings.aiPrioritizationEnabled = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Nazwa / ścieżka lokalnego CLI")
      .setDesc("Polecenie lokalne dla agenta CLI (domyślnie: trinitec-mail)")
      .addText((t) =>
        t.setValue(this.plugin.settings.cliExecutablePath).onChange(async (v) => {
          this.plugin.settings.cliExecutablePath = v.trim();
          await this.plugin.saveSettings();
        })
      );

    const catHeader = containerEl.createDiv({ cls: "tl-actions-row" });
    catHeader.createEl("h3", { text: "Kategorie i mapowanie folderów" });
    const addCatBtn = catHeader.createEl("button", {
      text: "Dodaj kategorię",
      type: "button",
      cls: "mod-cta",
    });
    addCatBtn.addEventListener("click", () => {
      new CategoryRuleModal(
        this.app,
        null,
        async (newRule) => {
          this.plugin.settings.aiCategories.push(newRule);
          await this.plugin.saveSettings();
          this.display();
        },
        this.plugin.cacheService
      ).open();
    });

    const table = containerEl.createEl("table", { cls: "tl-table" });
    const head = table.createTHead().insertRow();
    head.createEl("th", { text: "Kategoria" });
    head.createEl("th", { text: "Folder IMAP" });
    head.createEl("th", { text: "Temat Vault" });
    head.createEl("th", { text: "Słowa kluczowe / Regex" });
    head.createEl("th", { text: "Akcje" });

    const body = table.createTBody();
    for (const rule of this.plugin.settings.aiCategories) {
      const tr = body.insertRow();
      tr.createEl("td", { text: rule.label });
      tr.createEl("td", { text: rule.imapFolder });
      tr.createEl("td", { text: rule.vaultTopic });
      tr.createEl("td", {
        text: rule.regexPattern
          ? `${rule.keywords.join(", ")} | /${rule.regexPattern}/i`
          : rule.keywords.join(", "),
      });
      const act = tr.createEl("td", { cls: "tl-actions-row" });

      const editBtn = act.createEl("button", { text: "Edytuj", type: "button" });
      editBtn.addEventListener("click", () => {
        new CategoryRuleModal(
          this.app,
          rule,
          async (updated) => {
            this.plugin.settings.aiCategories = this.plugin.settings.aiCategories.map((c) =>
              c.id === rule.id ? updated : c
            );
            await this.plugin.saveSettings();
            this.display();
          },
          this.plugin.cacheService
        ).open();
      });

      const delBtn = act.createEl("button", { text: "Usuń", type: "button" });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.aiCategories = this.plugin.settings.aiCategories.filter(
          (c) => c.id !== rule.id
        );
        await this.plugin.saveSettings();
        this.display();
      });
    }
  }

  private renderHowToUseTab(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Jak używać Thunder Look (autor: Piotr Świerk)" });

    containerEl.createEl("p", {
      text: "Thunder Look łączy bezpośredniego klienta IMAP/SMTP (Roundcube z polem Serwer/Domena, Gmail przez OAuth2 w przeglądarce lub Hasło aplikacji, Outlook/Office 365) z bazą wiedzy Obsidian w ścisłym trybie Opt-in.",
    });

    containerEl.createEl("h4", { text: "1. Dostępne komendy w Palecie Poleceń (Ctrl + P)" });
    const cmdList = containerEl.createEl("ul");
    const commands = [
      "Thunder Look: Otwórz skrzynkę IMAP — 3-kolumnowy widok poczty (Foldery | Wątki | Izolowany podgląd HTML z blokadą pikseli i trybem offline).",
      "Thunder Look: Podgląd rozmiaru skrzynki i folderów — skanuje zajętość IMAP (GETQUOTAROOT / STATUS / RFC822.SIZE).",
      "Thunder Look: Wyślij nowy e-mail (SMTP) — kompozytor z podpowiadaniem kontaktów MRU, podpisem, załącznikami i 5-sekundowym „Cofnij wysyłkę”.",
      "Thunder Look: Wklej i zapisz e-mail ze schowka — parsuje surową wiadomość do okna zapisu Opt-in.",
      "Thunder Look: Utwórz nowy projekt — tworzy strukturę katalogów projektu i notatkę główną.",
      "Thunder Look: Zarchiwizuj aktywny projekt — ustawia status: archive i przenosi projekt do archiwum.",
      "Thunder Look: Analizuj aktywną notatkę (AI) — kategoryzuje notatkę, ustawia priorytet i wyodrębnia zadania.",
    ];
    for (const c of commands) cmdList.createEl("li", { text: c });

    containerEl.createEl("h4", { text: "2. Wątkowanie, deduplikacja i bezpieczne załączniki" });
    containerEl.createEl("p", {
      text: "Przy zapisie wiadomości Thunder Look sprawdza duplikaty (Message-ID i hash treści), wykrywa wcześniejsze notatki w wątku (automatyczne wikilinki) oraz domyślnie odznacza potencjalnie niebezpieczne rozszerzenia (.exe, .ps1, .js, .bat, .iso) i deduplikuje pliki po SHA-256.",
    });

    containerEl.createEl("h4", { text: "3. Blok kodu w notatce projektu (```thunder-look```)" });
    const pre = containerEl.createEl("pre");
    pre.createEl("code", {
      text: "```thunder-look\nproject: 26-125\ntopic: Korespondencja\nlimit: 15\n```",
    });
    containerEl.createEl("p", {
      text: "Blok wyświetla żywą tabelę korespondencji (kompatybilny również ze starszą nazwą ```trinitec-mail```). W razie błędu składni przycisk „Edytuj blok” pozostaje zawsze dostępny.",
    });

    containerEl.createEl("h4", { text: "4. Praca z agentem AI (MCP / CLI — bez kluczy API)" });
    containerEl.createEl("p", {
      text: "Pakiet mcp-cli izoluje treść maili przed Prompt Injection i domyślnie uruchamia się w trybie Read-Only (plik ai-policy.example.json).",
    });
  }
}
