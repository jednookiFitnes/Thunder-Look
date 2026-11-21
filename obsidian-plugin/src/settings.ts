import { App, Modal, Notice, PluginSettingTab, Setting } from "obsidian";
import { evaluateMailRules, type ClientMailRule } from "../../shared/folderMapper";
import { AiApplyMode, SaveDestinationMode } from "./types";
import { CategoryRuleModal } from "./modals/CategoryRuleModal";
import { EmailSettingsSection } from "./components/EmailSettingsSection";
import type TrinitecMailPlugin from "./main";

type SettingsSubTab = "general" | "rules" | "ai" | "help";

class MailRuleEditorModal extends Modal {
  private rule: ClientMailRule;
  private onSave: (rule: ClientMailRule) => void | Promise<void>;

  constructor(
    app: App,
    existing: ClientMailRule | null,
    onSave: (rule: ClientMailRule) => void | Promise<void>
  ) {
    super(app);
    this.onSave = onSave;
    this.rule = existing
      ? JSON.parse(JSON.stringify(existing))
      : {
          id: `rule-${Date.now().toString(36)}`,
          name: "Nowa reguła pocztowa",
          enabled: true,
          matchAll: true,
          conditions: [{ field: "from", contains: "" }],
          actions: { star: true },
        };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tl-confirm-modal");

    contentEl.createEl("h3", { text: "Reguła filtrowania poczty (Thunder Look)" });

    new Setting(contentEl).setName("Nazwa reguły").addText((t) =>
      t.setValue(this.rule.name).onChange((v) => {
        this.rule.name = v.trim() || "Reguła";
      })
    );

    const cond = this.rule.conditions[0] || { field: "from", contains: "" };
    this.rule.conditions[0] = cond;

    new Setting(contentEl).setName("Warunek (pole)").addDropdown((dd) =>
      dd
        .addOption("from", "Nadawca zawiera")
        .addOption("domain", "Domena nadawcy (np. trinitec.pl)")
        .addOption("subject", "Temat zawiera")
        .addOption("hasAttachment", "Wiadomość posiada załącznik")
        .setValue(cond.field)
        .onChange((v) => {
          cond.field = v as "from" | "subject" | "domain" | "hasAttachment";
          if (cond.field === "hasAttachment") cond.hasAttachment = true;
        })
    );

    new Setting(contentEl)
      .setName("Wartość warunku")
      .setDesc("Ignorowane dla warunku „posiada załącznik”.")
      .addText((t) =>
        t
          .setPlaceholder("np. faktura lub trinitec.pl")
          .setValue(cond.contains || "")
          .onChange((v) => {
            cond.contains = v.trim();
          })
      );

    new Setting(contentEl).setName("Akcja: Oznacz gwiazdką (\\Flagged)").addToggle((t) =>
      t.setValue(Boolean(this.rule.actions.star)).onChange((v) => {
        this.rule.actions.star = v;
      })
    );

    new Setting(contentEl).setName("Akcja: Oznacz jako przeczytaną (\\Seen)").addToggle((t) =>
      t.setValue(Boolean(this.rule.actions.markRead)).onChange((v) => {
        this.rule.actions.markRead = v;
      })
    );

    new Setting(contentEl)
      .setName("Akcja: Przenieś do folderu IMAP (opcjonalnie)")
      .addText((t) =>
        t
          .setPlaceholder("np. INBOX/Faktury")
          .setValue(this.rule.actions.moveToFolder || "")
          .onChange((v) => {
            this.rule.actions.moveToFolder = v.trim() || undefined;
          })
      );

    new Setting(contentEl)
      .setName("Akcja: Sugerowany kod projektu Vault (opcjonalnie)")
      .addText((t) =>
        t
          .setPlaceholder("np. 26-125")
          .setValue(this.rule.actions.suggestProjectCode || "")
          .onChange((v) => {
            this.rule.actions.suggestProjectCode = v.trim() || undefined;
          })
      );

    const footer = contentEl.createDiv({ cls: "tl-modal-footer-row" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj", type: "button" });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = footer.createEl("button", { text: "Zapisz regułę", type: "button", cls: "mod-cta" });
    saveBtn.addEventListener("click", async () => {
      await this.onSave(this.rule);
      this.close();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class TrinitecSettingTab extends PluginSettingTab {
  private plugin: TrinitecMailPlugin;
  private activeTab: SettingsSubTab = "general";
  private emailSection: EmailSettingsSection;

  constructor(app: App, plugin: TrinitecMailPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.emailSection = new EmailSettingsSection(this.plugin, () => this.display());
  }

  hide(): void {
    this.emailSection.onHide();
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("tl-settings-root");

    containerEl.createEl("h2", { text: "Thunder Look — Autor: Piotr Świerk" });

    const tabsBar = containerEl.createDiv({ cls: "tl-settings-tabs" });
    const tabs: Array<{ id: SettingsSubTab; label: string }> = [
      { id: "general", label: "Konta IMAP/SMTP i Vault" },
      { id: "rules", label: "Reguły pocztowe" },
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
    } else if (this.activeTab === "rules") {
      this.renderRulesTab(containerEl);
    } else if (this.activeTab === "ai") {
      this.renderAiTab(containerEl);
    } else {
      this.renderHowToUseTab(containerEl);
    }
  }

  private renderGeneralTab(containerEl: HTMLElement): void {
    this.emailSection.render(containerEl);

    containerEl.createEl("h3", { text: "Zachowanie klienta poczty, powiadomienia i bezpieczeństwo" });

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
      .setName("Automatyczne oznaczanie jako przeczytane po (sekundach)")
      .setDesc("Działa gdy tryb nieinwazyjny BODY.PEEK jest wyłączony (0 = wyłączone, np. 2 s).")
      .addText((t) =>
        t
          .setPlaceholder("0")
          .setValue(String(this.plugin.settings.autoMarkReadDelaySec ?? 0))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0 && n <= 60) {
              this.plugin.settings.autoMarkReadDelaySec = Math.floor(n);
              await this.plugin.saveSettings();
            }
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
      .setDesc(
        this.plugin.settings.trustedImageSenders.length > 0
          ? `Zaufani nadawcy obrazków: ${this.plugin.settings.trustedImageSenders.length}`
          : "Domyślnie blokuje wszystkie zdalne obrazki z opcją „Pokaż raz” lub „Zawsze ufaj nadawcy”."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.blockRemoteImagesByDefault).onChange(async (v) => {
          this.plugin.settings.blockRemoteImagesByDefault = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("IMAP IDLE w tle (powiadomienia push RFC 2177)")
      .setDesc("Utrzymuje lekkie połączenie w tle z odnawianiem co 14 minut i automatycznym wznawianiem po wybudzeniu komputera.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableImapIdle).onChange(async (v) => {
          this.plugin.settings.enableImapIdle = v;
          await this.plugin.saveSettings();
          await this.plugin.restartIdleWatchers();
        })
      );

    new Setting(containerEl)
      .setName("Powiadomienia systemowe (OS / Electron Notification)")
      .setDesc("Pokazuje natywne powiadomienie systemu operacyjnego po nadejściu nowej wiadomości — kliknięcie otwiera maila.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.desktopNotifications).onChange(async (v) => {
          this.plugin.settings.desktopNotifications = v;
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

    containerEl.createEl("h3", { text: "Struktura Vaulta, szablony odpowiedzi i polityka Opt-in" });

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
      .setName("Katalog szablonów odpowiedzi w Vaulcie")
      .setDesc("Pliki Markdown z tego folderu pojawiają się w edytorze maila (zmienne: {{sender_name}}, {{subject}}, {{date}}).")
      .addText((t) =>
        t
          .setPlaceholder("_Templates/Mail")
          .setValue(this.plugin.settings.replyTemplatesDir || "_Templates/Mail")
          .onChange(async (v) => {
            this.plugin.settings.replyTemplatesDir = v.trim();
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

  private renderRulesTab(containerEl: HTMLElement): void {
    const headerRow = containerEl.createDiv({ cls: "tl-actions-row" });
    headerRow.createEl("h3", { text: "Reguły pocztowe i filtry (po stronie klienta)" });

    const addBtn = headerRow.createEl("button", {
      text: "+ Dodaj regułę",
      type: "button",
      cls: "mod-cta",
    });
    addBtn.addEventListener("click", () => {
      new MailRuleEditorModal(this.app, null, async (newRule) => {
        this.plugin.settings.mailRules.push(newRule);
        await this.plugin.saveSettings();
        this.display();
      }).open();
    });

    const runNowBtn = headerRow.createEl("button", {
      text: "Uruchom reguły na INBOX teraz",
      type: "button",
    });
    runNowBtn.addEventListener("click", async () => {
      if (this.plugin.settings.mailRules.length === 0) {
        new Notice("Brak zdefiniowanych reguł pocztowych.");
        return;
      }
      runNowBtn.disabled = true;
      try {
        const activeAcc = this.plugin.imapService.resolveAccount();
        const folder = activeAcc.inboxFolder || "INBOX";
        const headers = await this.plugin.imapService.listMessages(folder, 50, false, activeAcc.id);
        let applied = 0;
        for (const h of headers) {
          const evalRes = evaluateMailRules(this.plugin.settings.mailRules, {
            fromEmail: h.fromEmail,
            fromName: h.fromName,
            subject: h.subject,
            hasAttachments: Boolean(h.hasAttachments),
          });
          if (evalRes.matchedRules.length === 0) continue;
          if (evalRes.mergedActions.star && !h.flagged) {
            await this.plugin.imapService.setMessageFlag(folder, h.uid, "\\Flagged", true, activeAcc.id);
          }
          if (evalRes.mergedActions.markRead && !h.seen) {
            await this.plugin.imapService.setMessageFlag(folder, h.uid, "\\Seen", true, activeAcc.id);
          }
          if (evalRes.mergedActions.moveToFolder && evalRes.mergedActions.moveToFolder !== folder) {
            await this.plugin.imapService.moveMessage(
              folder,
              h.uid,
              evalRes.mergedActions.moveToFolder,
              activeAcc.id
            );
          }
          applied++;
        }
        new Notice(`Zastosowano reguły pocztowe do ${applied} wiadomości w ${folder}.`);
      } catch (err) {
        new Notice(`Błąd uruchamiania reguł: ${(err as Error).message}`);
      } finally {
        runNowBtn.disabled = false;
      }
    });

    containerEl.createEl("p", {
      cls: "tl-muted-sm",
      text: "Reguły działają automatycznie dla nowych wiadomości przychodzących przez IMAP IDLE oraz na żądanie po kliknięciu „Uruchom reguły na INBOX teraz”.",
    });

    if (this.plugin.settings.mailRules.length === 0) {
      containerEl.createDiv({
        cls: "tl-empty-state",
        text: "Brak reguł. Kliknij „+ Dodaj regułę”, aby automatycznie gwiazdkować, oznaczać jako przeczytane lub przenosić wiadomości do wybranych folderów IMAP.",
      });
      return;
    }

    const table = containerEl.createEl("table", { cls: "tl-table" });
    const head = table.createTHead().insertRow();
    head.createEl("th", { text: "Aktywna" });
    head.createEl("th", { text: "Nazwa" });
    head.createEl("th", { text: "Warunek" });
    head.createEl("th", { text: "Akcje" });
    head.createEl("th", { text: "Zarządzaj" });

    const body = table.createTBody();
    for (const rule of this.plugin.settings.mailRules) {
      const tr = body.insertRow();
      const toggleTd = tr.createEl("td");
      const cb = toggleTd.createEl("input", { type: "checkbox" });
      cb.checked = rule.enabled;
      cb.addEventListener("change", async () => {
        rule.enabled = cb.checked;
        await this.plugin.saveSettings();
      });

      tr.createEl("td", { text: rule.name });
      const condSummary = rule.conditions
        .map((c) => (c.field === "hasAttachment" ? "Ma załącznik" : `${c.field}: ${c.contains || ""}`))
        .join(" AND ");
      tr.createEl("td", { text: condSummary });

      const actSummary = [
        rule.actions.star ? "Gwiazdka" : "",
        rule.actions.markRead ? "Przeczytane" : "",
        rule.actions.moveToFolder ? `Przenieś → ${rule.actions.moveToFolder}` : "",
        rule.actions.suggestProjectCode ? `Projekt ${rule.actions.suggestProjectCode}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      tr.createEl("td", { text: actSummary || "—" });

      const manageTd = tr.createEl("td", { cls: "tl-actions-row" });
      const editBtn = manageTd.createEl("button", { text: "Edytuj", type: "button" });
      editBtn.addEventListener("click", () => {
        new MailRuleEditorModal(this.app, rule, async (updated) => {
          this.plugin.settings.mailRules = this.plugin.settings.mailRules.map((r) =>
            r.id === rule.id ? updated : r
          );
          await this.plugin.saveSettings();
          this.display();
        }).open();
      });
      const delBtn = manageTd.createEl("button", { text: "Usuń", type: "button" });
      delBtn.addEventListener("click", async () => {
        this.plugin.settings.mailRules = this.plugin.settings.mailRules.filter(
          (r) => r.id !== rule.id
        );
        await this.plugin.saveSettings();
        this.display();
      });
    }
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
      text: "Thunder Look to pełny, szybki klient poczty IMAP/SMTP klasy desktopowej (Multi-Account, Unified Inbox, trwałe sesje IMAP, wyszukiwanie serwerowe, wątki, szkice, załączniki, skróty klawiszowe) zintegrowany z bazą wiedzy Obsidian w ścisłym trybie Opt-in.",
    });

    containerEl.createEl("h4", { text: "1. Skróty klawiszowe w oknie poczty" });
    containerEl.createEl("p", {
      text: "J/↓ i K/↑ (nawigacja), C (nowy mail), R (odpowiedz), A (odpowiedz wszystkim), F (przekaż), E (archiwizuj), Delete/# (usuń), S (gwiazdka), U (przeczytane), / (szukaj), ? (pełna ściąga skrótów).",
    });

    containerEl.createEl("h4", { text: "2. Wyszukiwanie serwerowe IMAP" });
    containerEl.createEl("p", {
      text: "Wpisz np. from:jan has:attachment is:unread after:2026-01-01 i naciśnij Enter. Dla Gmaila Thunder Look wykorzystuje natywne X-GM-RAW.",
    });

    containerEl.createEl("h4", { text: "3. Blok kodu w notatce projektu (```thunder-look```)" });
    const pre = containerEl.createEl("pre");
    pre.createEl("code", {
      text: "```thunder-look\nproject: 26-125\ntopic: Korespondencja\nlimit: 15\n```",
    });
  }
}
