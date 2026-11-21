import { Notice } from "obsidian";
import { PROVIDER_PRESETS } from "../../../shared/types";
import { FullDiagnosticsReport, MailProviderPreset } from "../types";
import type TrinitecMailPlugin from "../main";
import { renderProviderPresetBar } from "./emailSettings/ProviderPresetBar";
import {
  renderCredentialsForm,
  type CredentialsFormState,
} from "./emailSettings/CredentialsForm";
import { renderDiagnosticsPanel } from "./emailSettings/FullDiagnosticsRunner";

/**
 * Zmodularizowany komponent „Szybka konfiguracja i ustawienia poczty” dla Thunder Look:
 * - Presety: Roundcube (z polem Serwer/Domena np. trinitec.pl), Gmail (OAuth2 przeglądarka + Hasło aplikacji), Outlook/M365, Własny IMAP
 * - Szyfrowane sekrety (SecretStorage / safeStorage / AES-256-GCM)
 * - Pełna diagnostyka krok po kroku (IMAP + SMTP + zapisywalność Vaulta)
 */
export class EmailSettingsSection {
  private plugin: TrinitecMailPlugin;
  private containerEl: HTMLElement;
  private onRerender: () => void;

  private formState: CredentialsFormState = {
    draftPassword: "",
    showPassword: false,
    hasStoredPassword: false,
    oauthConnectedEmail: null,
    oauthBusy: false,
  };

  private isTesting = false;
  private lastReport: FullDiagnosticsReport | null = null;
  private hydratedSecrets = false;

  constructor(plugin: TrinitecMailPlugin, containerEl: HTMLElement, onRerender: () => void) {
    this.plugin = plugin;
    this.containerEl = containerEl;
    this.onRerender = onRerender;
  }

  render(): void {
    const wrapper = this.containerEl.createDiv({ cls: "tl-email-settings" });
    wrapper.createEl("h3", {
      text: "Szybka konfiguracja poczty (Roundcube / Gmail / Outlook / IMAP)",
    });

    renderProviderPresetBar({
      wrapper,
      activeProvider: this.plugin.settings.mailProvider || "roundcube",
      onSelectPreset: (preset) => this.applyPreset(preset),
    });

    renderCredentialsForm({
      wrapper,
      plugin: this.plugin,
      state: this.formState,
      onRerender: () => this.onRerender(),
    });

    renderDiagnosticsPanel({
      wrapper,
      plugin: this.plugin,
      getDraftPassword: () => this.formState.draftPassword,
      isTesting: this.isTesting,
      setIsTesting: (v) => {
        this.isTesting = v;
      },
      lastReport: this.lastReport,
      setLastReport: (r) => {
        this.lastReport = r;
      },
    });

    if (!this.hydratedSecrets) {
      this.hydratedSecrets = true;
      void this.hydrateSecretStatus();
    }
  }

  private async hydrateSecretStatus(): Promise<void> {
    const [pwd, oauth] = await Promise.all([
      this.plugin.secretService.getMailPassword(),
      this.plugin.secretService.getGoogleOAuthTokens(),
    ]);
    const hasPwd = Boolean(pwd && pwd.length > 0);
    const oauthEmail = oauth?.email || (oauth?.accessToken ? "konto Google" : null);
    if (
      hasPwd !== this.formState.hasStoredPassword ||
      oauthEmail !== this.formState.oauthConnectedEmail
    ) {
      this.formState.hasStoredPassword = hasPwd;
      this.formState.oauthConnectedEmail = oauthEmail;
      this.onRerender();
    }
  }

  private async applyPreset(presetId: MailProviderPreset): Promise<void> {
    const spec = PROVIDER_PRESETS[presetId];
    this.plugin.settings.mailProvider = presetId;
    if (presetId === "gmail") {
      this.plugin.settings.mailAuthMethod = this.plugin.settings.googleOAuthClientId
        ? "google-oauth"
        : "password";
    } else {
      this.plugin.settings.mailAuthMethod = "password";
    }

    if (presetId !== "custom") {
      this.plugin.settings.serverDomain =
        presetId === "roundcube" ? "trinitec.pl" : spec.imapHost;
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
    this.lastReport = null;
    new Notice(`Zastosowano profil poczty: ${spec.label}`);
    this.onRerender();
  }
}
