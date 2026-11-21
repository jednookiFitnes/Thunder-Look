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

    containerEl.createEl("h2", { text: "Trinitec Mail & Project Manager" });

    // Podzakładki ustawień (w tym obowiązkowa z AGENTS.md zakładka „Jak używać”)
    const tabsBar = containerEl.createDiv({ cls: "trinitec-mail-settings-tabs" });
    const tabs: Array<{ id: SettingsSubTab; label: string }> = [
      { id: "general", label: "Poczta IMAP/SMTP i Vault" },
      { id: "ai", label: "Analiza AI (MCP / CLI)" },
      { id: "help", label: "Jak używać" },
    ];

    for (const tab of tabs) {
      const btn = tabsBar.createEl("button", {
        text: tab.label,
        cls: `trinitec-mail-settings-tab-btn${this.activeTab === tab.id ? " is-active" : ""}`,
      });
      btn.onclick = () => {
        this.activeTab = tab.id;
        this.display();
      };
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
    // Dedykowany komponent UI ustawień poczty (Roundcube.pl / Gmail / test połączenia)
    new EmailSettingsSection(this.plugin, containerEl, () => this.display()).render();

    containerEl.createEl("h3", { text: "Zachowanie klienta poczty" });

    new Setting(containerEl)
      .setName("Nieinwazyjny podgląd (EXAMINE / BODY.PEEK)")
      .setDesc("Odczyt i skanowanie rozmiaru skrzynki nie oznaczają maili jako przeczytanych w Roundcube.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.nonIntrusivePeek).onChange(async (v) => {
          this.plugin.settings.nonIntrusivePeek = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Automatyczna kopia wysłanych w folderze Sent (IMAP APPEND)")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.appendSentToImap).onChange(async (v) => {
          this.plugin.settings.appendSentToImap = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Blokuj zdalne obrazy i piksele śledzące w HTML")
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

    containerEl.createEl("h3", { text: "Struktura Praca Vault i polityka Opt-in" });

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

    // Tabela kategorii AI — zgodnie z AGENTS.md edycja WYŁĄCZNIE przez pływający modal CategoryRuleModal!
    const catHeader = containerEl.createDiv({ cls: "trinitec-mail-actions-row" });
    catHeader.createEl("h3", { text: "Kategorie i mapowanie folderów" });
    const addCatBtn = catHeader.createEl("button", { text: "Dodaj kategorię", cls: "mod-cta" });
    addCatBtn.onclick = () => {
      new CategoryRuleModal(this.app, null, async (newRule) => {
        this.plugin.settings.aiCategories.push(newRule);
        await this.plugin.saveSettings();
        this.display();
      }).open();
    };

    const table = containerEl.createEl("table", { cls: "trinitec-mail-table" });
    const head = table.createTHead().insertRow();
    head.createEl("th", { text: "Kategoria" });
    head.createEl("th", { text: "Folder IMAP" });
    head.createEl("th", { text: "Temat Vault" });
    head.createEl("th", { text: "Słowa kluczowe" });
    head.createEl("th", { text: "Akcje" });

    const body = table.createTBody();
    for (const rule of this.plugin.settings.aiCategories) {
      const tr = body.insertRow();
      tr.createEl("td", { text: rule.label });
      tr.createEl("td", { text: rule.imapFolder });
      tr.createEl("td", { text: rule.vaultTopic });
      tr.createEl("td", { text: rule.keywords.join(", ") });
      const act = tr.createEl("td");

      const editBtn = act.createEl("button", { text: "Edytuj" });
      editBtn.onclick = () => {
        new CategoryRuleModal(this.app, rule, async (updated) => {
          this.plugin.settings.aiCategories = this.plugin.settings.aiCategories.map((c) =>
            c.id === rule.id ? updated : c
          );
          await this.plugin.saveSettings();
          this.display();
        }).open();
      };

      const delBtn = act.createEl("button", { text: "Usuń" });
      delBtn.style.marginLeft = "6px";
      delBtn.onclick = async () => {
        this.plugin.settings.aiCategories = this.plugin.settings.aiCategories.filter(
          (c) => c.id !== rule.id
        );
        await this.plugin.saveSettings();
        this.display();
      };
    }
  }

  /**
   * Obowiązkowa zakładka dokumentacji w języku polskim (AGENTS.md).
   */
  private renderHowToUseTab(containerEl: HTMLElement): void {
    containerEl.createEl("h3", { text: "Jak używać Trinitec Mail & Project Manager" });

    containerEl.createEl("p", {
      text: "Wtyczka łączy bezpośredniego klienta IMAP/SMTP (Roundcube) z bazą wiedzy Praca Vault w ścisłym trybie Opt-in: żadna wiadomość nie trafia do Twoich notatek bez Twojej wyraźnej decyzji.",
    });

    containerEl.createEl("h4", { text: "1. Dostępne komendy w Palecie Poleceń (Ctrl + P)" });
    const cmdList = containerEl.createEl("ul");
    const commands = [
      "Trinitec: Otwórz skrzynkę IMAP — otwiera 3-kolumnowy widok poczty (Foldery | Wątki | Podgląd z blokadą pikseli).",
      "Trinitec: Podgląd rozmiaru skrzynki i folderów — skanuje zajętość IMAP (GETQUOTAROOT / STATUS / RFC822.SIZE) z sortowaniem największych maili.",
      "Trinitec: Wyślij nowy e-mail (SMTP) — otwiera kompozytor z podpowiadaniem kontaktów (MRU), załącznikami z Vaulta i automatyczną kopią w Sent.",
      "Trinitec: Parse email from clipboard — wkleja surowy e-mail ze schowka prosto do okna zapisu Opt-in.",
      "Trinitec: Create new project — tworzy folder YY-XXX - Klient - Nazwa, notatkę główną z _base_trinitec_projekty.base#Embeded oraz podfoldery.",
      "Trinitec: Archive active project — ustawia status: archive i bezpiecznie przenosi katalog projektu do archiwum.",
      "Trinitec: Analizuj aktywną notatkę (AI) — kategoryzuje notatkę, określa priorytet i dopisuje wykryte zadania Obsidian Tasks.",
    ];
    for (const c of commands) cmdList.createEl("li", { text: c });

    containerEl.createEl("h4", { text: "2. Świadomy zapis wycinka lub załączników" });
    containerEl.createEl("p", {
      text: "Zaznacz myszką dowolny fragment w podglądzie wiadomości i kliknij „Zapisz w Vaulcie (Opt-in)”. Wtyczka automatycznie przełączy tryb na „Wybrany fragment treści”, rozpozna projekt (po kodzie YY-XXX lub kontakcie w kontakty/), sprawdzi duplikaty po Message-ID i pozwoli wybrać: osobny plik lub dopisanie do istniejącej notatki.",
    });

    containerEl.createEl("h4", { text: "3. Blok kodu w notatce projektu (```trinitec-mail```)" });
    const pre = containerEl.createEl("pre");
    pre.createEl("code", {
      text: "```trinitec-mail\nproject: 26-125\ntopic: Korespondencja\nlimit: 15\n```",
    });
    containerEl.createEl("p", {
      text: "Blok wyświetla tabelę zapisanej korespondencji projektu. W razie błędu parametrów przycisk „Edytuj blok” zawsze pozostaje dostępny.",
    });

    containerEl.createEl("h4", { text: "4. Praca z agentem AI (Antigravity / MCP / CLI — bez kluczy API)" });
    containerEl.createEl("p", {
      text: "Uruchom lokalny pakiet trinitec-mail-mcp-cli (najlepiej poza OneDrive, np. w C:\\Tools\\trinitec-mail-mcp-cli\\) i wklej konfigurację stdio do Antigravity. Domyślnie serwer MCP startuje w bezpiecznym trybie Read-Only, dopóki nie włączysz uprawnień zapisu w trinitec-ai-policy.json.",
    });
  }
}
