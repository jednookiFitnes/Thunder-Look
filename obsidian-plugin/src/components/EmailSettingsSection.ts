import { Notice } from "obsidian";
import { PROVIDER_PRESETS } from "../../../shared/types";
import { isGmailHostname } from "../../../shared/networkSecurity";
import {
  ACCOUNT_COLOR_PALETTE,
  DEFAULT_ACCOUNT,
  FullDiagnosticsReport,
  MailAccountConfig,
  MailProviderPreset,
} from "../types";
import {
  getActiveAccount,
  syncActiveAccountToTopLevel,
} from "../utils/settingsMigration";
import type TrinitecMailPlugin from "../main";
import { renderProviderPresetBar } from "./emailSettings/ProviderPresetBar";
import {
  applyPasswordStatusUi,
  formatOAuthStatusText,
  looksLikeGmailAppPassword,
  renderCredentialsForm,
  type CredentialsFormRefs,
  type CredentialsFormState,
} from "./emailSettings/CredentialsForm";
import { renderDiagnosticsPanel } from "./emailSettings/FullDiagnosticsRunner";

/**
 * Zmodularizowany komponent „Konta pocztowe i konfiguracja IMAP/SMTP” dla Thunder Look:
 * - Obsługa wielu skrzynek pocztowych (Multi-Account) z oddzielnymi sekretami w electron.safeStorage.
 * - Presety: Roundcube, Gmail (OAuth2 przeglądarka + Hasło aplikacji), Outlook/M365, Własny IMAP.
 * - Pełna diagnostyka krok po kroku (IMAP + SMTP + zapisywalność Vaulta).
 *
 * UWAGA ARCHITEKTONICZNA:
 * Odczyt statusu sekretów aktualizuje DOM wyłącznie w miejscu (in-place) bez wywoływania
 * pełnego display(), co uniemożliwia pętlę ponownego renderowania i zacinanie Obsidiana.
 */
export class EmailSettingsSection {
  private plugin: TrinitecMailPlugin;
  private onRerender: () => void;

  private formState: CredentialsFormState = {
    draftPassword: "",
    showPassword: false,
    hasStoredPassword: false,
    storedPasswordLength: 0,
    storedPasswordValidGmailAppPwd: true,
    oauthConnectedEmail: null,
    oauthBusy: false,
  };

  private isTesting = false;
  private lastReport: FullDiagnosticsReport | null = null;
  private hydratedAccountId: string | null = null;
  private hydratingPromise: Promise<void> | null = null;
  private renderGeneration = 0;
  private statusRefs: CredentialsFormRefs = {
    passwordStatusEl: null,
    passwordInputEl: null,
    oauthStatusEl: null,
  };

  constructor(plugin: TrinitecMailPlugin, onRerender: () => void) {
    this.plugin = plugin;
    this.onRerender = onRerender;
  }

  onHide(): void {
    this.renderGeneration += 1;
    this.hydratedAccountId = null;
    this.hydratingPromise = null;
    this.formState.draftPassword = "";
    this.formState.showPassword = false;
    this.statusRefs = { passwordStatusEl: null, passwordInputEl: null, oauthStatusEl: null };
  }

  private resetDraftState(): void {
    this.hydratedAccountId = null;
    this.hydratingPromise = null;
    this.lastReport = null;
    this.formState = {
      draftPassword: "",
      showPassword: false,
      hasStoredPassword: false,
      storedPasswordLength: 0,
      storedPasswordValidGmailAppPwd: true,
      oauthConnectedEmail: null,
      oauthBusy: false,
    };
  }

  render(containerEl: HTMLElement): void {
    const gen = ++this.renderGeneration;
    const wrapper = containerEl.createDiv({ cls: "tl-email-settings" });
    wrapper.createEl("h3", {
      text: "Konta pocztowe (Multi-Account · Roundcube / Gmail / Outlook / IMAP)",
    });

    const activeAccount = getActiveAccount(this.plugin.settings);

    // Pasek wyboru konta + Dodaj / Usuń konto
    const accBar = wrapper.createDiv({ cls: "tl-settings-accounts-bar" });
    for (const acc of this.plugin.settings.accounts) {
      const btn = accBar.createEl("button", {
        type: "button",
        cls: `tl-account-tab-btn${acc.id === activeAccount.id ? " is-active" : ""}`,
      });
      const dot = btn.createSpan({ cls: "tl-account-dot" });
      dot.style.backgroundColor = acc.color;
      btn.createSpan({ text: acc.label || acc.imapUser || acc.id });
      btn.addEventListener("click", async () => {
        if (acc.id === activeAccount.id) return;
        this.plugin.settings.activeAccountId = acc.id;
        syncActiveAccountToTopLevel(this.plugin.settings);
        await this.plugin.saveSettings();
        this.resetDraftState();
        this.onRerender();
      });
    }

    const addBtn = accBar.createEl("button", {
      type: "button",
      cls: "tl-account-tab-add",
      text: "+ Dodaj konto",
    });
    addBtn.addEventListener("click", async () => {
      const idx = this.plugin.settings.accounts.length;
      const nextColor = ACCOUNT_COLOR_PALETTE[idx % ACCOUNT_COLOR_PALETTE.length];
      const newAcc: MailAccountConfig = {
        ...DEFAULT_ACCOUNT,
        id: `acc-${Date.now().toString(36)}`,
        label: `Konto #${idx + 1}`,
        color: nextColor,
        imapUser: "",
      };
      this.plugin.settings.accounts.push(newAcc);
      this.plugin.settings.activeAccountId = newAcc.id;
      syncActiveAccountToTopLevel(this.plugin.settings);
      await this.plugin.saveSettings();
      this.resetDraftState();
      new Notice(`Dodano nowe konto: ${newAcc.label}`);
      this.onRerender();
    });

    if (this.plugin.settings.accounts.length > 1) {
      const delBtn = accBar.createEl("button", {
        type: "button",
        cls: "tl-account-tab-del",
        text: "Usuń bieżące konto",
      });
      delBtn.addEventListener("click", async () => {
        const removeId = activeAccount.id;
        await this.plugin.secretService.clearMailPassword(removeId).catch(() => {});
        await this.plugin.secretService.clearGoogleOAuthTokens(removeId).catch(() => {});
        await this.plugin.imapService.disconnectAccount(removeId).catch(() => {});
        this.plugin.settings.accounts = this.plugin.settings.accounts.filter(
          (a) => a.id !== removeId
        );
        this.plugin.settings.activeAccountId = this.plugin.settings.accounts[0]?.id || "default";
        syncActiveAccountToTopLevel(this.plugin.settings);
        await this.plugin.saveSettings();
        this.resetDraftState();
        new Notice(`Usunięto konto „${activeAccount.label}”.`);
        this.onRerender();
      });
    }

    renderProviderPresetBar({
      wrapper,
      activeProvider: activeAccount.mailProvider || "roundcube",
      onSelectPreset: (preset) => this.applyPreset(activeAccount, preset),
    });

    this.statusRefs = renderCredentialsForm({
      wrapper,
      plugin: this.plugin,
      account: activeAccount,
      state: this.formState,
      onRerender: () => this.onRerender(),
    });

    renderDiagnosticsPanel({
      wrapper,
      plugin: this.plugin,
      account: activeAccount,
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

    if (this.hydratedAccountId !== activeAccount.id && !this.hydratingPromise) {
      this.hydratingPromise = this.hydrateSecretStatus(activeAccount, gen).finally(() => {
        this.hydratingPromise = null;
      });
    }
  }

  private async hydrateSecretStatus(
    account: MailAccountConfig,
    expectedGeneration: number
  ): Promise<void> {
    try {
      const [pwd, oauth] = await Promise.all([
        this.plugin.secretService.getMailPassword(account.id),
        this.plugin.secretService.getGoogleOAuthTokens(account.id),
      ]);
      this.hydratedAccountId = account.id;

      const hasPwd = Boolean(pwd && pwd.length > 0);
      const oauthEmail = oauth?.email || (oauth?.accessToken ? "konto Google" : null);
      this.formState.hasStoredPassword = hasPwd;
      this.formState.storedPasswordLength = pwd ? pwd.length : 0;
      this.formState.storedPasswordValidGmailAppPwd = hasPwd
        ? looksLikeGmailAppPassword(pwd)
        : true;
      this.formState.oauthConnectedEmail = oauthEmail;

      if (expectedGeneration !== this.renderGeneration) return;

      const isGmail = account.mailProvider === "gmail" || isGmailHostname(account.imapHost);

      // Aktualizacja w miejscu (in-place) — NIGDY nie wywołujemy tu onRerender()
      applyPasswordStatusUi(this.statusRefs, this.formState, isGmail);
      if (this.statusRefs.oauthStatusEl) {
        this.statusRefs.oauthStatusEl.setText(formatOAuthStatusText(oauthEmail));
      }
    } catch {
      this.hydratedAccountId = account.id;
    }
  }

  private async applyPreset(
    account: MailAccountConfig,
    presetId: MailProviderPreset
  ): Promise<void> {
    const spec = PROVIDER_PRESETS[presetId];
    account.mailProvider = presetId;
    if (presetId === "gmail") {
      account.mailAuthMethod = account.googleOAuthClientId ? "google-oauth" : "password";
    } else {
      account.mailAuthMethod = "password";
    }

    if (presetId !== "custom") {
      account.serverDomain = presetId === "roundcube" ? "trinitec.pl" : spec.imapHost;
      account.imapHost = spec.imapHost;
      account.imapPort = spec.imapPort;
      account.imapSecure = spec.imapSecure;
      account.smtpHost = spec.smtpHost;
      account.smtpPort = spec.smtpPort;
      account.smtpSecure = spec.smtpSecure;
    }

    account.sentFolder = spec.sentFolder;
    account.archiveFolder = spec.archiveFolder;
    account.trashFolder = spec.trashFolder;
    account.appendSentToImap = spec.appendSentToImap;
    syncActiveAccountToTopLevel(this.plugin.settings);
    await this.plugin.saveSettings();
    this.lastReport = null;
    new Notice(`Zastosowano profil poczty: ${spec.label}`);
    this.onRerender();
  }
}
