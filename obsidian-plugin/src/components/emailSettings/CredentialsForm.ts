import { Notice, Setting } from "obsidian";
import {
  isGmailHostname,
  resolveServerHostFromDomain,
} from "../../../../shared/networkSecurity";
import { ACCOUNT_COLOR_PALETTE, MailAccountConfig, MailAuthMethod } from "../../types";
import { syncActiveAccountToTopLevel } from "../../utils/settingsMigration";
import type TrinitecMailPlugin from "../../main";

export interface CredentialsFormState {
  draftPassword: string;
  showPassword: boolean;
  hasStoredPassword: boolean;
  storedPasswordLength: number;
  storedPasswordValidGmailAppPwd: boolean;
  oauthConnectedEmail: string | null;
  oauthBusy: boolean;
}

export interface CredentialsFormRefs {
  passwordStatusEl: HTMLElement | null;
  passwordInputEl: HTMLInputElement | null;
  oauthStatusEl: HTMLElement | null;
}

export function looksLikeGmailAppPassword(value: string): boolean {
  const compact = String(value || "").replace(/\s+/g, "");
  return /^[a-z]{16}$/i.test(compact);
}

export function formatPasswordPlaceholder(state: CredentialsFormState, isGmail: boolean): string {
  if (state.hasStoredPassword) {
    const lenLabel = state.storedPasswordLength > 0 ? ` (${state.storedPasswordLength} zn.)` : "";
    return `•••••••••••• zapisane${lenLabel} — wpisz nowe, aby zmienić`;
  }
  return isGmail ? "xxxx xxxx xxxx xxxx (Hasło aplikacji)" : "Wpisz hasło i kliknij Zapisz hasło";
}

export function applyPasswordStatusUi(
  refs: CredentialsFormRefs,
  state: CredentialsFormState,
  isGmail: boolean
): void {
  if (refs.passwordInputEl && !state.draftPassword) {
    refs.passwordInputEl.placeholder = formatPasswordPlaceholder(state, isGmail);
  }
  const el = refs.passwordStatusEl;
  if (!el) return;

  el.className = "tl-password-status";
  if (!state.hasStoredPassword) {
    el.classList.add("is-empty");
    el.setText(
      "Brak zapisanego hasła — wpisz hasło powyżej i kliknij niebieski przycisk „Zapisz hasło”."
    );
    return;
  }

  const lenInfo = state.storedPasswordLength > 0 ? ` (${state.storedPasswordLength} znaków)` : "";
  if (isGmail && !state.storedPasswordValidGmailAppPwd) {
    el.classList.add("is-warn");
    el.setText(
      `⚠ Hasło jest zapisane${lenInfo}, ale NIE wygląda na 16-literowe Hasło aplikacji Google (np. abcd efgh ijkl mnop). Gmail odrzuca zwykłe hasło konta błędem 534-5.7.9 — wygeneruj Hasło aplikacji na myaccount.google.com/apppasswords.`
    );
    return;
  }

  el.classList.add("is-saved");
  el.setText(
    `✓ Hasło jest zapisane bezpiecznie${lenInfo} w lokalnym magazynie urządzenia. Pole powyżej pozostaje puste dla bezpieczeństwa — kliknij „Pokaż”, aby je podejrzeć, albo wpisz nowe, aby nadpisać.`
  );
}

export function formatOAuthStatusText(oauthConnectedEmail: string | null): string {
  return oauthConnectedEmail
    ? `Połączono przez Google OAuth2 jako: ${oauthConnectedEmail}`
    : "Brak aktywnej sesji Google OAuth2 na tym urządzeniu.";
}

export function renderCredentialsForm(params: {
  wrapper: HTMLElement;
  plugin: TrinitecMailPlugin;
  account: MailAccountConfig;
  state: CredentialsFormState;
  onRerender: () => void;
}): CredentialsFormRefs {
  const { wrapper, plugin, account, state, onRerender } = params;
  const refs: CredentialsFormRefs = {
    passwordStatusEl: null,
    passwordInputEl: null,
    oauthStatusEl: null,
  };

  const persistAccount = async () => {
    syncActiveAccountToTopLevel(plugin.settings);
    await plugin.saveSettings();
  };

  const isGmail = account.mailProvider === "gmail" || isGmailHostname(account.imapHost);
  const isRoundcubeOrCustom =
    account.mailProvider === "roundcube" || account.mailProvider === "custom";

  // 0. Etykieta i kolor konta (Multi-Account)
  new Setting(wrapper)
    .setName("Etykieta i kolor konta")
    .setDesc("Np. „Prywatny Gmail” lub „Służbowy Trinitec” — wyświetlane w przełączniku kont i Unified Inbox.")
    .addText((t) =>
      t
        .setPlaceholder("Główna skrzynka")
        .setValue(account.label)
        .onChange(async (v) => {
          account.label = v.trim() || "Skrzynka";
          await persistAccount();
        })
    )
    .addDropdown((dd) => {
      const colorNames: Record<string, string> = {
        "#6366f1": "Indygo",
        "#10b981": "Szmaragd",
        "#f59e0b": "Bursztyn",
        "#ec4899": "Różowy",
        "#06b6d4": "Cyjan",
        "#8b5cf6": "Fiolet",
      };
      for (const hex of ACCOUNT_COLOR_PALETTE) {
        dd.addOption(hex, colorNames[hex] || hex);
      }
      dd.setValue(account.color || ACCOUNT_COLOR_PALETTE[0]).onChange(async (v) => {
        account.color = v;
        await persistAccount();
        onRerender();
      });
    });

  // 1. Dedykowane pole „Serwer / Domena” (Roundcube)
  if (isRoundcubeOrCustom) {
    new Setting(wrapper)
      .setName("Serwer / Domena (jak w Roundcube, np. trinitec.pl)")
      .setDesc(
        "Wpisz domenę lub adres serwera z logowania Roundcube — automatycznie zaktualizuje host IMAP i SMTP."
      )
      .addText((t) =>
        t
          .setPlaceholder("trinitec.pl")
          .setValue(account.serverDomain || account.imapHost)
          .onChange(async (v) => {
            const parsed = resolveServerHostFromDomain(v);
            account.serverDomain = parsed.host;
            if (parsed.host) {
              account.imapHost = parsed.host;
              account.smtpHost = parsed.host;
              if (parsed.detectedPort) account.imapPort = parsed.detectedPort;
              if (parsed.detectedSecure !== null) {
                account.imapSecure = parsed.detectedSecure;
              }
            }
            await persistAccount();
          })
      );
  }

  // 2. Metoda uwierzytelniania Google (OAuth2 przez przeglądarkę LUB Hasło aplikacji)
  if (isGmail) {
    new Setting(wrapper)
      .setName("Metoda logowania do Gmail")
      .setDesc(
        "Wybierz logowanie przez przeglądarkę (Google OAuth2 PKCE) albo 16-znakowe Hasło aplikacji Google."
      )
      .addDropdown((dd) =>
        dd
          .addOption("google-oauth", "Logowanie przez Google w przeglądarce (OAuth2)")
          .addOption("password", "Hasło aplikacji Google (16 znaków)")
          .setValue(account.mailAuthMethod)
          .onChange(async (v) => {
            account.mailAuthMethod = v as MailAuthMethod;
            await persistAccount();
            onRerender();
          })
      );

    if (account.mailAuthMethod === "google-oauth") {
      new Setting(wrapper)
        .setName("Google OAuth Client ID (typ: Desktop App)")
        .setDesc(
          "Utwórz klienta OAuth typu Desktop App w Google Cloud Console (bez client_secret — PKCE RFC 8252 przez 127.0.0.1)."
        )
        .addText((t) =>
          t
            .setPlaceholder("xxxx.apps.googleusercontent.com")
            .setValue(account.googleOAuthClientId)
            .onChange(async (v) => {
              account.googleOAuthClientId = v.trim();
              await persistAccount();
            })
        );

      const oauthBox = wrapper.createDiv({ cls: "tl-oauth-box" });
      refs.oauthStatusEl = oauthBox.createDiv({
        cls: "tl-status-text",
        text: formatOAuthStatusText(state.oauthConnectedEmail),
      });

      const btnRow = oauthBox.createDiv({ cls: "tl-actions-row" });
      const signInBtn = btnRow.createEl("button", {
        text: state.oauthBusy
          ? "Oczekiwanie na logowanie w przeglądarce..."
          : state.oauthConnectedEmail
          ? "Zaloguj ponownie przez Google"
          : "Zaloguj przez Google (przeglądarka)",
        type: "button",
        cls: "mod-cta tl-google-btn",
      });
      signInBtn.disabled = state.oauthBusy;
      signInBtn.addEventListener("click", async () => {
        if (state.oauthBusy) return;
        state.oauthBusy = true;
        onRerender();
        try {
          const bundle = await plugin.googleOAuthService.signInViaBrowser(
            account.googleOAuthClientId,
            120_000,
            account.id
          );
          if (bundle.email) {
            account.imapUser = bundle.email;
            await persistAccount();
          }
          state.oauthConnectedEmail = bundle.email || account.imapUser || "konto Google";
          new Notice(`Połączono z Google: ${state.oauthConnectedEmail}`);
        } catch (err) {
          new Notice(`Logowanie Google nie powiodło się: ${(err as Error).message}`);
        } finally {
          state.oauthBusy = false;
          onRerender();
        }
      });

      if (state.oauthConnectedEmail) {
        const signOutBtn = btnRow.createEl("button", {
          text: "Wyloguj z Google",
          type: "button",
        });
        signOutBtn.addEventListener("click", async () => {
          await plugin.googleOAuthService.signOut(account.id);
          state.oauthConnectedEmail = null;
          new Notice("Usunięto tokeny sesji Google OAuth2 z magazynu urządzenia.");
          onRerender();
        });
      }
    }
  }

  // 3. Pola IMAP
  new Setting(wrapper)
    .setName("Host serwera IMAP")
    .setDesc("Np. trinitec.pl, mail.twojadomena.pl, imap.gmail.com lub outlook.office365.com")
    .addText((t) =>
      t
        .setPlaceholder("trinitec.pl")
        .setValue(account.imapHost)
        .onChange(async (v) => {
          account.imapHost = v.trim();
          if (isGmailHostname(v.trim())) {
            account.mailProvider = "gmail";
          }
          await persistAccount();
        })
    );

  new Setting(wrapper)
    .setName("Port IMAP")
    .setDesc("Standardowo 993 (SSL/TLS) lub 143 (STARTTLS)")
    .addText((t) =>
      t
        .setPlaceholder("993")
        .setValue(String(account.imapPort))
        .onChange(async (v) => {
          const parsed = Number(v);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
            account.imapPort = parsed;
            if (parsed === 993) account.imapSecure = true;
            if (parsed === 143) account.imapSecure = false;
            await persistAccount();
          }
        })
    );

  new Setting(wrapper)
    .setName("Szyfrowanie IMAP (bezpośredni SSL/TLS)")
    .setDesc("Włącz dla portu 993 (zalecane). Wyłącz dla STARTTLS na porcie 143.")
    .addToggle((t) =>
      t.setValue(account.imapSecure).onChange(async (v) => {
        account.imapSecure = v;
        if (v && account.imapPort === 143) account.imapPort = 993;
        else if (!v && account.imapPort === 993) account.imapPort = 143;
        await persistAccount();
        onRerender();
      })
    );

  new Setting(wrapper)
    .setName("Ścisła weryfikacja certyfikatu TLS (zalecane)")
    .setDesc(
      "Domyślnie zawsze włączona. Wyłączenie akceptuje niezweryfikowane certyfikaty i obniża ochronę przed atakami MITM."
    )
    .addToggle((t) =>
      t.setValue(account.strictTlsVerification).onChange(async (v) => {
        account.strictTlsVerification = v;
        await persistAccount();
        onRerender();
      })
    );

  if (!account.strictTlsVerification) {
    wrapper.createDiv({
      cls: "tl-banner-danger",
      text: "Ostrzeżenie bezpieczeństwa: weryfikacja certyfikatów TLS jest wyłączona. Używaj tego trybu wyłącznie dla zaufanych serwerów w sieci lokalnej.",
    });
  }

  // 4. Pola SMTP
  new Setting(wrapper)
    .setName("Host serwera SMTP")
    .setDesc("Do wysyłki wiadomości (np. trinitec.pl, smtp.gmail.com, smtp.office365.com)")
    .addText((t) =>
      t
        .setPlaceholder("trinitec.pl")
        .setValue(account.smtpHost)
        .onChange(async (v) => {
          account.smtpHost = v.trim();
          await persistAccount();
        })
    );

  new Setting(wrapper)
    .setName("Port SMTP (465 SSL/TLS lub 587 STARTTLS)")
    .addText((t) =>
      t
        .setPlaceholder("465")
        .setValue(String(account.smtpPort))
        .onChange(async (v) => {
          const parsed = Number(v);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
            account.smtpPort = parsed;
            account.smtpSecure = parsed === 465;
            await persistAccount();
          }
        })
    );

  // 5. Dane nadawcy i logowania
  new Setting(wrapper)
    .setName("Nazwa wyświetlana nadawcy")
    .setDesc("Imię i nazwisko widoczne w nagłówku Od (From).")
    .addText((t) =>
      t
        .setPlaceholder("Piotr Świerk")
        .setValue(account.senderName)
        .onChange(async (v) => {
          account.senderName = v.trim();
          await persistAccount();
        })
    );

  new Setting(wrapper)
    .setName("Podpis w wysyłanych wiadomościach")
    .setDesc("Automatycznie dołączany przy tworzeniu odpowiedzi i nowych wiadomości.")
    .addTextArea((ta) => {
      ta.setValue(account.emailSignature);
      ta.inputEl.rows = 3;
      ta.onChange(async (v) => {
        account.emailSignature = v;
        await persistAccount();
      });
    });

  new Setting(wrapper)
    .setName("Login / adres e-mail")
    .setDesc("Pełny adres skrzynki (np. imie@trinitec.pl lub uzytkownik@gmail.com).")
    .addText((t) =>
      t
        .setPlaceholder("twoj.adres@trinitec.pl")
        .setValue(account.imapUser)
        .onChange(async (v) => {
          account.imapUser = v.trim();
          await persistAccount();
        })
    );

  // 6. Pole hasła (gdy nie używamy wyłącznie Google OAuth2)
  if (!isGmail || account.mailAuthMethod === "password") {
    const passwordSetting = new Setting(wrapper)
      .setName(isGmail ? "Hasło aplikacji Google (16 znaków)" : "Hasło skrzynki pocztowej")
      .setDesc(
        `Magazyn lokalny: ${plugin.secretService.getStorageBackendLabel()}. Nigdy nie trafia do pliku data.json ani chmury.`
      );

    if (isGmail) {
      const linkLine = passwordSetting.descEl.createDiv({ cls: "tl-inline-link-row" });
      linkLine.createSpan({
        text: "Wymagane 16-literowe Hasło aplikacji (nie zwykłe hasło konta): ",
      });
      const appPwdLink = linkLine.createEl("a", {
        text: "myaccount.google.com/apppasswords",
        href: "https://myaccount.google.com/apppasswords",
        cls: "tl-inline-link",
      });
      appPwdLink.setAttr("target", "_blank");
      appPwdLink.setAttr("rel", "noopener noreferrer");
    }

    let passwordInputEl: HTMLInputElement | null = null;
    passwordSetting.addText((t) => {
      passwordInputEl = t.inputEl;
      refs.passwordInputEl = t.inputEl;
      t.inputEl.type = state.showPassword ? "text" : "password";
      t.setPlaceholder(formatPasswordPlaceholder(state, isGmail));
      t.setValue(state.draftPassword);
      t.onChange((v) => {
        state.draftPassword = v;
      });
    });

    passwordSetting.addButton((btn) =>
      btn.setButtonText(state.showPassword ? "Ukryj" : "Pokaż").onClick(async () => {
        state.showPassword = !state.showPassword;
        if (state.showPassword && !state.draftPassword && state.hasStoredPassword) {
          try {
            const saved = await plugin.secretService.getMailPassword(account.id);
            if (saved && passwordInputEl) {
              state.draftPassword = saved;
              passwordInputEl.value = saved;
            }
          } catch {
            // ignore
          }
        }
        if (passwordInputEl) {
          passwordInputEl.type = state.showPassword ? "text" : "password";
        }
        btn.setButtonText(state.showPassword ? "Ukryj" : "Pokaż");
      })
    );

    passwordSetting.addButton((btn) =>
      btn
        .setButtonText("Zapisz hasło")
        .setCta()
        .onClick(async () => {
          const cleaned = isGmail
            ? state.draftPassword.replace(/\s+/g, "")
            : state.draftPassword;
          if (!cleaned) {
            new Notice(
              state.hasStoredPassword
                ? "Hasło jest już zapisane. Wpisz nowe hasło w pole, jeśli chcesz je zmienić."
                : "Wpisz najpierw hasło przed zapisaniem."
            );
            return;
          }
          btn.setDisabled(true);
          try {
            await plugin.secretService.setMailPassword(cleaned, account.id);
            state.draftPassword = "";
            state.showPassword = false;
            state.hasStoredPassword = true;
            state.storedPasswordLength = cleaned.length;
            state.storedPasswordValidGmailAppPwd = looksLikeGmailAppPassword(cleaned);
            if (passwordInputEl) {
              passwordInputEl.type = "password";
              passwordInputEl.value = "";
            }
            applyPasswordStatusUi(refs, state, isGmail);
            if (isGmail && !state.storedPasswordValidGmailAppPwd) {
              new Notice(
                "Zapisano hasło, ale nie wygląda ono na 16-literowe Hasło aplikacji Google — Gmail odrzuci zwykłe hasło konta (błąd 534-5.7.9)."
              );
            } else {
              new Notice(`Zapisano hasło bezpiecznie (${cleaned.length} znaków).`);
            }
          } catch (err) {
            new Notice(
              `Nie udało się zapisać hasła: ${err instanceof Error ? err.message : String(err)}`
            );
          } finally {
            btn.setDisabled(false);
          }
        })
    );

    passwordSetting.addButton((btn) =>
      btn.setButtonText("Usuń").onClick(async () => {
        btn.setDisabled(true);
        try {
          await plugin.secretService.clearMailPassword(account.id);
          state.draftPassword = "";
          state.showPassword = false;
          state.hasStoredPassword = false;
          state.storedPasswordLength = 0;
          state.storedPasswordValidGmailAppPwd = true;
          if (passwordInputEl) {
            passwordInputEl.type = "password";
            passwordInputEl.value = "";
          }
          applyPasswordStatusUi(refs, state, isGmail);
          new Notice("Usunięto zapisane hasło z lokalnego magazynu.");
        } catch (err) {
          new Notice(
            `Nie udało się usunąć hasła: ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          btn.setDisabled(false);
        }
      })
    );

    refs.passwordStatusEl = wrapper.createDiv({ cls: "tl-password-status" });
    applyPasswordStatusUi(refs, state, isGmail);
  }

  return refs;
}
