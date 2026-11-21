import { Notice, Setting } from "obsidian";
import {
  isGmailHostname,
  resolveServerHostFromDomain,
} from "../../../../shared/networkSecurity";
import { MailAuthMethod } from "../../types";
import type TrinitecMailPlugin from "../../main";

export interface CredentialsFormState {
  draftPassword: string;
  showPassword: boolean;
  hasStoredPassword: boolean;
  oauthConnectedEmail: string | null;
  oauthBusy: boolean;
}

export function renderCredentialsForm(params: {
  wrapper: HTMLElement;
  plugin: TrinitecMailPlugin;
  state: CredentialsFormState;
  onRerender: () => void;
}): void {
  const { wrapper, plugin, state, onRerender } = params;
  const isGmail =
    plugin.settings.mailProvider === "gmail" || isGmailHostname(plugin.settings.imapHost);
  const isRoundcubeOrCustom =
    plugin.settings.mailProvider === "roundcube" || plugin.settings.mailProvider === "custom";

  // 1. Dedykowane pole „Serwer / Domena” znane z ekranu logowania Roundcube (np. trinitec.pl)
  if (isRoundcubeOrCustom) {
    new Setting(wrapper)
      .setName("Serwer / Domena (jak w Roundcube, np. trinitec.pl)")
      .setDesc(
        "Wpisz domenę lub adres serwera z logowania Roundcube — automatycznie zaktualizuje host IMAP i SMTP."
      )
      .addText((t) =>
        t
          .setPlaceholder("trinitec.pl")
          .setValue(plugin.settings.serverDomain || plugin.settings.imapHost)
          .onChange(async (v) => {
            const parsed = resolveServerHostFromDomain(v);
            plugin.settings.serverDomain = parsed.host;
            if (parsed.host) {
              plugin.settings.imapHost = parsed.host;
              plugin.settings.smtpHost = parsed.host;
              if (parsed.detectedPort) plugin.settings.imapPort = parsed.detectedPort;
              if (parsed.detectedSecure !== null) {
                plugin.settings.imapSecure = parsed.detectedSecure;
              }
            }
            await plugin.saveSettings();
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
          .setValue(plugin.settings.mailAuthMethod)
          .onChange(async (v) => {
            plugin.settings.mailAuthMethod = v as MailAuthMethod;
            await plugin.saveSettings();
            onRerender();
          })
      );

    if (plugin.settings.mailAuthMethod === "google-oauth") {
      new Setting(wrapper)
        .setName("Google OAuth Client ID (typ: Desktop App)")
        .setDesc(
          "Utwórz klienta OAuth typu Desktop App w Google Cloud Console (bez client_secret — PKCE RFC 8252 przez 127.0.0.1)."
        )
        .addText((t) =>
          t
            .setPlaceholder("xxxx.apps.googleusercontent.com")
            .setValue(plugin.settings.googleOAuthClientId)
            .onChange(async (v) => {
              plugin.settings.googleOAuthClientId = v.trim();
              await plugin.saveSettings();
            })
        );

      const oauthBox = wrapper.createDiv({ cls: "tl-oauth-box" });
      const statusText = state.oauthConnectedEmail
        ? `Połączono przez Google OAuth2 jako: ${state.oauthConnectedEmail}`
        : "Brak aktywnej sesji Google OAuth2 na tym urządzeniu.";
      oauthBox.createDiv({ cls: "tl-status-text", text: statusText });

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
            plugin.settings.googleOAuthClientId
          );
          if (bundle.email) {
            plugin.settings.imapUser = bundle.email;
            await plugin.saveSettings();
          }
          state.oauthConnectedEmail = bundle.email || plugin.settings.imapUser || "konto Google";
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
          await plugin.googleOAuthService.signOut();
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
        .setValue(plugin.settings.imapHost)
        .onChange(async (v) => {
          plugin.settings.imapHost = v.trim();
          if (isGmailHostname(v.trim())) {
            plugin.settings.mailProvider = "gmail";
          }
          await plugin.saveSettings();
        })
    );

  new Setting(wrapper)
    .setName("Port IMAP")
    .setDesc("Standardowo 993 (SSL/TLS) lub 143 (STARTTLS)")
    .addText((t) =>
      t
        .setPlaceholder("993")
        .setValue(String(plugin.settings.imapPort))
        .onChange(async (v) => {
          const parsed = Number(v);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
            plugin.settings.imapPort = parsed;
            if (parsed === 993) plugin.settings.imapSecure = true;
            if (parsed === 143) plugin.settings.imapSecure = false;
            await plugin.saveSettings();
          }
        })
    );

  new Setting(wrapper)
    .setName("Szyfrowanie IMAP (bezpośredni SSL/TLS)")
    .setDesc("Włącz dla portu 993 (zalecane). Wyłącz dla STARTTLS na porcie 143.")
    .addToggle((t) =>
      t.setValue(plugin.settings.imapSecure).onChange(async (v) => {
        plugin.settings.imapSecure = v;
        if (v && plugin.settings.imapPort === 143) plugin.settings.imapPort = 993;
        else if (!v && plugin.settings.imapPort === 993) plugin.settings.imapPort = 143;
        await plugin.saveSettings();
        onRerender();
      })
    );

  new Setting(wrapper)
    .setName("Ścisła weryfikacja certyfikatu TLS (zalecane)")
    .setDesc(
      "Domyślnie zawsze włączona. Wyłączenie akceptuje niezweryfikowane certyfikaty i obniża ochronę przed atakami MITM."
    )
    .addToggle((t) =>
      t.setValue(plugin.settings.strictTlsVerification).onChange(async (v) => {
        plugin.settings.strictTlsVerification = v;
        await plugin.saveSettings();
        onRerender();
      })
    );

  if (!plugin.settings.strictTlsVerification) {
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
        .setValue(plugin.settings.smtpHost)
        .onChange(async (v) => {
          plugin.settings.smtpHost = v.trim();
          await plugin.saveSettings();
        })
    );

  new Setting(wrapper)
    .setName("Port SMTP (465 SSL/TLS lub 587 STARTTLS)")
    .addText((t) =>
      t
        .setPlaceholder("465")
        .setValue(String(plugin.settings.smtpPort))
        .onChange(async (v) => {
          const parsed = Number(v);
          if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
            plugin.settings.smtpPort = parsed;
            plugin.settings.smtpSecure = parsed === 465;
            await plugin.saveSettings();
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
        .setValue(plugin.settings.senderName)
        .onChange(async (v) => {
          plugin.settings.senderName = v.trim();
          await plugin.saveSettings();
        })
    );

  new Setting(wrapper)
    .setName("Podpis w wysyłanych wiadomościach")
    .setDesc("Automatycznie dołączany przy tworzeniu odpowiedzi i nowych wiadomości.")
    .addTextArea((ta) => {
      ta.setValue(plugin.settings.emailSignature);
      ta.inputEl.rows = 3;
      ta.onChange(async (v) => {
        plugin.settings.emailSignature = v;
        await plugin.saveSettings();
      });
    });

  new Setting(wrapper)
    .setName("Login / adres e-mail")
    .setDesc("Pełny adres skrzynki (np. imie@trinitec.pl lub uzytkownik@gmail.com).")
    .addText((t) =>
      t
        .setPlaceholder("twoj.adres@trinitec.pl")
        .setValue(plugin.settings.imapUser)
        .onChange(async (v) => {
          plugin.settings.imapUser = v.trim();
          await plugin.saveSettings();
        })
    );

  // 6. Pole hasła (gdy nie używamy wyłącznie Google OAuth2)
  if (!isGmail || plugin.settings.mailAuthMethod === "password") {
    const passwordSetting = new Setting(wrapper)
      .setName(
        isGmail ? "Hasło aplikacji Google (16 znaków)" : "Hasło skrzynki pocztowej"
      )
      .setDesc(
        `Magazyn lokalny: ${plugin.secretService.getStorageBackendLabel()}. Nigdy nie trafia do pliku data.json ani chmury.`
      );

    let passwordInputEl: HTMLInputElement | null = null;
    passwordSetting.addText((t) => {
      passwordInputEl = t.inputEl;
      t.inputEl.type = state.showPassword ? "text" : "password";
      t.setPlaceholder(
        isGmail ? "xxxx xxxx xxxx xxxx" : "Wpisz hasło i kliknij Zapisz hasło"
      );
      t.setValue(state.draftPassword);
      t.onChange((v) => {
        state.draftPassword = v;
      });
    });

    passwordSetting.addButton((btn) =>
      btn.setButtonText(state.showPassword ? "Ukryj" : "Pokaż").onClick(() => {
        state.showPassword = !state.showPassword;
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
            new Notice("Wpisz najpierw hasło przed zapisaniem.");
            return;
          }
          await plugin.secretService.setMailPassword(cleaned);
          state.draftPassword = "";
          state.hasStoredPassword = true;
          if (passwordInputEl) passwordInputEl.value = "";
          new Notice("Zapisano hasło bezpiecznie w lokalnym magazynie urządzenia.");
          onRerender();
        })
    );

    passwordSetting.addButton((btn) =>
      btn.setButtonText("Usuń").onClick(async () => {
        await plugin.secretService.clearMailPassword();
        state.draftPassword = "";
        state.hasStoredPassword = false;
        if (passwordInputEl) passwordInputEl.value = "";
        new Notice("Usunięto zapisane hasło z lokalnego magazynu.");
        onRerender();
      })
    );

    wrapper.createDiv({
      cls: "tl-status-text",
      text: state.hasStoredPassword
        ? "Status hasła: zapisane bezpiecznie (zaszyfrowane lokalnie na tym urządzeniu)."
        : "Status hasła: brak zapisanego hasła (wpisz je powyżej i kliknij „Zapisz hasło”).",
    });
  }
}
