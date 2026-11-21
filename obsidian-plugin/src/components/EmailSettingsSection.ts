import { Notice, Setting } from "obsidian";
import { ImapConnectionTestResult, MailProviderPreset } from "../types";
import { formatBytes } from "../utils/textUtils";
import type TrinitecMailPlugin from "../main";

interface ProviderPresetSpec {
  id: MailProviderPreset;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  sentFolder: string;
  archiveFolder: string;
  trashFolder: string;
  appendSentToImap: boolean;
  description: string;
}

const PROVIDER_PRESETS: Record<MailProviderPreset, ProviderPresetSpec> = {
  roundcube: {
    id: "roundcube",
    label: "Roundcube.pl",
    imapHost: "imap.roundcube.pl",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.roundcube.pl",
    smtpPort: 465,
    smtpSecure: true,
    sentFolder: "Sent",
    archiveFolder: "Archive",
    trashFolder: "Trash",
    appendSentToImap: true,
    description:
      "Konfiguracja kompatybilna z Roundcube.pl oraz własnym hostingiem (IMAP SSL/TLS 993 + SMTP 465 + automatyczny IMAP APPEND do folderu Sent).",
  },
  gmail: {
    id: "gmail",
    label: "Gmail (IMAP + Hasło aplikacji)",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    sentFolder: "[Gmail]/Sent Mail",
    archiveFolder: "[Gmail]/All Mail",
    trashFolder: "[Gmail]/Trash",
    appendSentToImap: false,
    description:
      "Gmail przez IMAP/SMTP bez kluczy API ani OAuth: wymaga włączonej weryfikacji dwuetapowej i wygenerowania 16-znakowego Hasła aplikacji Google (Konto Google → Bezpieczeństwo → Hasła aplikacji). Wtyczka automatycznie rozpoznaje polskie nazwy folderów ([Gmail]/Wysłane) i pomija dublowanie kopii w Wysłanych.",
  },
  custom: {
    id: "custom",
    label: "Własny serwer IMAP",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    sentFolder: "Sent",
    archiveFolder: "Archive",
    trashFolder: "Trash",
    appendSentToImap: true,
    description:
      "Dowolny serwer zgodny z RFC 3501 (Dovecot, Cyrus, Roundcube na własnej domenie, Home.pl, OVH, nazwa.pl).",
  },
};

/**
 * Dedykowany komponent UI „Ustawienia poczty” (Email Settings) dla wtyczki Obsidian:
 * - Presety dostawców: Roundcube.pl, Gmail (Hasło aplikacji), Własny serwer IMAP
 * - Pola IMAP (host, port, SSL/TLS, weryfikacja certyfikatu), SMTP oraz poświadczenia (SecretStorage)
 * - Przycisk testu połączenia weryfikujący ustawienia na żywo wobec serwera IMAP/SMTP
 */
export class EmailSettingsSection {
  private plugin: TrinitecMailPlugin;
  private containerEl: HTMLElement;
  private onRerender: () => void;

  private draftPassword = "";
  private showPassword = false;
  private alsoTestSmtp = true;
  private isTesting = false;
  private lastResult: ImapConnectionTestResult | null = null;
  private hasStoredPassword = false;

  constructor(plugin: TrinitecMailPlugin, containerEl: HTMLElement, onRerender: () => void) {
    this.plugin = plugin;
    this.containerEl = containerEl;
    this.onRerender = onRerender;
  }

  render(): void {
    const wrapper = this.containerEl.createDiv({ cls: "trinitec-mail-email-settings" });
    wrapper.createEl("h3", { text: "Ustawienia poczty IMAP / SMTP (Roundcube.pl i Gmail)" });

    // Pasek presetów dostawcy
    const presetRow = wrapper.createDiv({ cls: "trinitec-mail-preset-row" });
    const presets: MailProviderPreset[] = ["roundcube", "gmail", "custom"];
    for (const presetId of presets) {
      const spec = PROVIDER_PRESETS[presetId];
      const isActive = (this.plugin.settings.mailProvider || "roundcube") === presetId;
      const btn = presetRow.createEl("button", {
        text: spec.label,
        cls: `trinitec-mail-preset-btn${isActive ? " is-active" : ""}`,
      });
      btn.onclick = async () => {
        await this.applyPreset(presetId);
      };
    }

    const activePreset = PROVIDER_PRESETS[this.plugin.settings.mailProvider || "roundcube"];
    wrapper.createDiv({
      cls: "trinitec-mail-info-box",
      text: activePreset.description,
    });

    // Sekcja IMAP
    new Setting(wrapper)
      .setName("Host serwera IMAP")
      .setDesc("Np. imap.roundcube.pl, mail.twojadomena.pl lub imap.gmail.com")
      .addText((t) =>
        t
          .setPlaceholder("imap.roundcube.pl")
          .setValue(this.plugin.settings.imapHost)
          .onChange(async (v) => {
            this.plugin.settings.imapHost = v.trim();
            if (this.plugin.imapService.isGmailServer(v.trim())) {
              this.plugin.settings.mailProvider = "gmail";
            }
            await this.plugin.saveSettings();
          })
      );

    new Setting(wrapper)
      .setName("Port IMAP")
      .setDesc("Standardowo 993 (SSL/TLS) lub 143 (STARTTLS)")
      .addText((t) =>
        t
          .setPlaceholder("993")
          .setValue(String(this.plugin.settings.imapPort))
          .onChange(async (v) => {
            const parsed = Number(v);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
              this.plugin.settings.imapPort = parsed;
              if (parsed === 993) this.plugin.settings.imapSecure = true;
              if (parsed === 143) this.plugin.settings.imapSecure = false;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(wrapper)
      .setName("Szyfrowanie IMAP (bezpośredni SSL/TLS)")
      .setDesc("Włącz dla portu 993 (zalecane dla Roundcube.pl i Gmail). Wyłącz dla STARTTLS na porcie 143.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.imapSecure).onChange(async (v) => {
          this.plugin.settings.imapSecure = v;
          if (v && this.plugin.settings.imapPort === 143) {
            this.plugin.settings.imapPort = 993;
          } else if (!v && this.plugin.settings.imapPort === 993) {
            this.plugin.settings.imapPort = 143;
          }
          await this.plugin.saveSettings();
          this.onRerender();
        })
      );

    new Setting(wrapper)
      .setName("Ścisła weryfikacja certyfikatu TLS")
      .setDesc("Odrzuca nieprawidłowe lub samopodpisane certyfikaty serwera (zalecane).")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.strictTlsVerification).onChange(async (v) => {
          this.plugin.settings.strictTlsVerification = v;
          await this.plugin.saveSettings();
        })
      );

    // Sekcja SMTP
    new Setting(wrapper)
      .setName("Host serwera SMTP")
      .setDesc("Do wysyłki odpowiedzi z Obsidiana (np. smtp.roundcube.pl lub smtp.gmail.com)")
      .addText((t) =>
        t
          .setPlaceholder("smtp.roundcube.pl")
          .setValue(this.plugin.settings.smtpHost)
          .onChange(async (v) => {
            this.plugin.settings.smtpHost = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(wrapper)
      .setName("Port SMTP (465 SSL/TLS lub 587 STARTTLS)")
      .addText((t) =>
        t
          .setPlaceholder("465")
          .setValue(String(this.plugin.settings.smtpPort))
          .onChange(async (v) => {
            const parsed = Number(v);
            if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
              this.plugin.settings.smtpPort = parsed;
              this.plugin.settings.smtpSecure = parsed === 465;
              await this.plugin.saveSettings();
            }
          })
      );

    // Sekcja Poświadczenia
    new Setting(wrapper)
      .setName("Nazwa wyświetlana nadawcy")
      .setDesc("Imię i nazwisko widoczne w nagłówku Od (From) wysyłanych wiadomości.")
      .addText((t) =>
        t
          .setPlaceholder("Piotr Świerk")
          .setValue(this.plugin.settings.senderName)
          .onChange(async (v) => {
            this.plugin.settings.senderName = v.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(wrapper)
      .setName("Login / adres e-mail")
      .setDesc("Pełny adres skrzynki (np. imie@twojadomena.pl lub uzytkownik@gmail.com).")
      .addText((t) =>
        t
          .setPlaceholder("twoj.adres@domena.pl")
          .setValue(this.plugin.settings.imapUser)
          .onChange(async (v) => {
            this.plugin.settings.imapUser = v.trim();
            await this.plugin.saveSettings();
          })
      );

    const passwordSetting = new Setting(wrapper)
      .setName(
        this.plugin.settings.mailProvider === "gmail"
          ? "Hasło aplikacji Google (16 znaków)"
          : "Hasło skrzynki pocztowej"
      )
      .setDesc(
        `Magazyn lokalny: ${this.plugin.secretService.getStorageBackendLabel()}. Nigdy nie trafia do pliku data.json ani OneDrive.`
      );

    let passwordInputEl: HTMLInputElement | null = null;
    passwordSetting.addText((t) => {
      passwordInputEl = t.inputEl;
      t.inputEl.type = this.showPassword ? "text" : "password";
      t.setPlaceholder(
        this.plugin.settings.mailProvider === "gmail"
          ? "xxxx xxxx xxxx xxxx (Hasło aplikacji)"
          : "Wpisz hasło i kliknij Zapisz hasło"
      );
      t.setValue(this.draftPassword);
      t.onChange((v) => {
        this.draftPassword = v;
      });
    });

    passwordSetting.addButton((btn) =>
      btn.setButtonText(this.showPassword ? "Ukryj" : "Pokaż").onClick(() => {
        this.showPassword = !this.showPassword;
        if (passwordInputEl) {
          passwordInputEl.type = this.showPassword ? "text" : "password";
        }
        btn.setButtonText(this.showPassword ? "Ukryj" : "Pokaż");
      })
    );

    passwordSetting.addButton((btn) =>
      btn
        .setButtonText("Zapisz hasło")
        .setCta()
        .onClick(async () => {
          const cleaned =
            this.plugin.settings.mailProvider === "gmail"
              ? this.draftPassword.replace(/\s+/g, "")
              : this.draftPassword;
          if (!cleaned) {
            new Notice("Wpisz najpierw hasło przed zapisaniem.");
            return;
          }
          await this.plugin.secretService.setMailPassword(cleaned);
          this.draftPassword = "";
          this.hasStoredPassword = true;
          if (passwordInputEl) passwordInputEl.value = "";
          new Notice("Zapisano hasło bezpiecznie w lokalnym magazynie urządzenia.");
          updatePasswordStatus();
        })
    );

    passwordSetting.addButton((btn) =>
      btn.setButtonText("Usuń").onClick(async () => {
        await this.plugin.secretService.clearMailPassword();
        this.draftPassword = "";
        this.hasStoredPassword = false;
        if (passwordInputEl) passwordInputEl.value = "";
        new Notice("Usunięto zapisane hasło z lokalnego magazynu.");
        updatePasswordStatus();
      })
    );

    const passwordStatusEl = wrapper.createDiv({ cls: "trinitec-mail-status-text" });
    const updatePasswordStatus = () => {
      passwordStatusEl.setText(
        this.hasStoredPassword
          ? "Status hasła: zapisane bezpiecznie lokalnie na tym urządzeniu."
          : "Status hasła: brak zapisanego hasła (możesz wpisać je powyżej do jednorazowego testu lub zapisać)."
      );
    };
    void this.plugin.secretService.getMailPassword().then((pwd) => {
      this.hasStoredPassword = Boolean(pwd && pwd.length > 0);
      updatePasswordStatus();
    });

    // Sekcja testu połączenia na żywo
    const resultContainer = wrapper.createDiv({ cls: "trinitec-mail-test-result-slot" });

    new Setting(wrapper)
      .setName("Weryfikacja połączenia z serwerem (Roundcube / Gmail)")
      .setDesc(
        "Łączy się z serwerem IMAP (nieinwazyjnie), sprawdza uwierzytelnienie, rozszerzenia IDLE/QUOTA/MOVE, listę folderów oraz opcjonalnie SMTP."
      )
      .addToggle((t) => {
        t.setTooltip("Testuj również serwer SMTP");
        t.setValue(this.alsoTestSmtp).onChange((v) => {
          this.alsoTestSmtp = v;
        });
      })
      .addButton((btn) => {
        btn
          .setButtonText(this.isTesting ? "Testowanie..." : "Testuj połączenie")
          .setCta()
          .setDisabled(this.isTesting)
          .onClick(async () => {
            if (this.isTesting) return;
            this.isTesting = true;
            btn.setDisabled(true);
            btn.setButtonText("Łączenie z serwerem...");
            resultContainer.empty();
            resultContainer.createDiv({
              cls: "trinitec-mail-status-text",
              text: `Trwa test połączenia z ${this.plugin.settings.imapHost}:${this.plugin.settings.imapPort}...`,
            });

            try {
              const pwdToUse =
                this.plugin.settings.mailProvider === "gmail" && this.draftPassword
                  ? this.draftPassword.replace(/\s+/g, "")
                  : this.draftPassword || undefined;

              const imapRes = await this.plugin.imapService.testConnection({
                host: this.plugin.settings.imapHost,
                port: this.plugin.settings.imapPort,
                secure: this.plugin.settings.imapSecure,
                user: this.plugin.settings.imapUser,
                password: pwdToUse,
                strictTls: this.plugin.settings.strictTlsVerification,
              });

              if (imapRes.ok && this.alsoTestSmtp && this.plugin.settings.smtpHost) {
                const smtpRes = await this.plugin.smtpService.verifyConnection({
                  host: this.plugin.settings.smtpHost,
                  port: this.plugin.settings.smtpPort,
                  secure: this.plugin.settings.smtpSecure,
                  user: this.plugin.settings.imapUser,
                  password: pwdToUse,
                  strictTls: this.plugin.settings.strictTlsVerification,
                });
                imapRes.smtpChecked = true;
                imapRes.smtpOk = smtpRes.ok;
                imapRes.smtpMessage = smtpRes.message;
              }

              // Zaktualizuj wykryty folder Sent (np. [Gmail]/Wysłane lub INBOX.Sent)
              if (imapRes.ok && imapRes.sentFolderDetected) {
                this.plugin.settings.sentFolder = imapRes.sentFolderDetected;
                await this.plugin.saveSettings();
              }

              this.lastResult = imapRes;
              this.renderTestResult(resultContainer, imapRes);

              if (imapRes.ok) {
                new Notice(
                  `Połączono z ${imapRes.host} (${imapRes.latencyMs} ms, ${imapRes.folderCount} folderów).`
                );
              } else {
                new Notice(`Test połączenia nie powiódł się: ${imapRes.error || "błąd"}`);
              }
            } finally {
              this.isTesting = false;
              btn.setDisabled(false);
              btn.setButtonText("Testuj połączenie");
            }
          });
      });

    if (this.lastResult) {
      this.renderTestResult(resultContainer, this.lastResult);
    }
  }

  private async applyPreset(presetId: MailProviderPreset): Promise<void> {
    const spec = PROVIDER_PRESETS[presetId];
    this.plugin.settings.mailProvider = presetId;
    if (presetId !== "custom") {
      this.plugin.settings.imapHost = spec.imapHost;
      this.plugin.settings.imapPort = spec.imapPort;
      this.plugin.settings.imapSecure = spec.imapSecure;
      this.plugin.settings.smtpHost = spec.smtpHost;
      this.plugin.settings.smtpPort = spec.smtpPort;
      this.plugin.settings.smtpSecure = spec.smtpSecure;
    }
    this.plugin.settings.sentFolder = spec.sentFolder;
    this.plugin.settings.archiveFolder = spec.archiveFolder;
    this.plugin.settings.trashFolder = spec.trashFolder;
    this.plugin.settings.appendSentToImap = spec.appendSentToImap;
    await this.plugin.saveSettings();
    this.lastResult = null;
    new Notice(`Zastosowano profil poczty: ${spec.label}`);
    this.onRerender();
  }

  private renderTestResult(container: HTMLElement, res: ImapConnectionTestResult): void {
    container.empty();
    const box = container.createDiv({
      cls: `trinitec-mail-test-result ${res.ok ? "is-success" : "is-error"}`,
    });

    if (res.ok) {
      const providerLabel =
        res.providerDetected === "gmail"
          ? "Gmail IMAP"
          : res.providerDetected === "roundcube"
          ? "Roundcube IMAP"
          : "Serwer IMAP";

      box.createDiv({
        cls: "trinitec-mail-test-result-title",
        text: `Połączenie zweryfikowane: ${providerLabel} (${res.host}:${res.port}) · ${res.latencyMs} ms`,
      });

      const lines = [
        `Foldery: ${res.folderCount} · INBOX: ${res.inboxMessages} wiadomości (${res.inboxUnseen} nieprzeczytanych)`,
        `Wykryty folder Wysłane (\\Sent): ${res.sentFolderDetected || "domyślny"}`,
      ];

      if (res.quotaLimitBytes && res.quotaUsedBytes !== null) {
        const pct = ((res.quotaUsedBytes / res.quotaLimitBytes) * 100).toFixed(1);
        lines.push(
          `Zajętość skrzynki (QUOTA): ${formatBytes(res.quotaUsedBytes)} / ${formatBytes(
            res.quotaLimitBytes
          )} (${pct}%)`
        );
      }

      const keyCaps = ["IDLE", "QUOTA", "MOVE", "UIDPLUS", "CONDSTORE", "X-GM-EXT-1"].filter((c) =>
        res.capabilities.includes(c)
      );
      if (keyCaps.length > 0) {
        lines.push(`Obsługiwane rozszerzenia: ${keyCaps.join(", ")}`);
      }

      if (res.smtpChecked) {
        lines.push(
          `SMTP: ${res.smtpOk ? "OK" : "Błąd"} — ${res.smtpMessage || ""}`
        );
      }

      for (const line of lines) {
        box.createDiv({ cls: "trinitec-mail-test-result-line", text: line });
      }
    } else {
      box.createDiv({
        cls: "trinitec-mail-test-result-title",
        text: `Błąd połączenia z ${res.host || "(brak hosta)"}:${res.port} (${res.latencyMs} ms)`,
      });
      if (res.error) {
        box.createDiv({ cls: "trinitec-mail-test-result-line", text: `Szczegóły: ${res.error}` });
      }
      if (res.hint) {
        box.createDiv({ cls: "trinitec-mail-test-result-hint", text: `Wskazówka: ${res.hint}` });
      }
    }
  }
}
