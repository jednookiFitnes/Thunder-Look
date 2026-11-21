import { App } from "obsidian";

interface ObsidianSecretStorageLike {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
}

const SECRET_KEY_MAIL_PASSWORD = "trinitec-mail-imap-password";
const FALLBACK_LOCAL_KEY = "trinitec-mail-local-secret-v1";

/**
 * Serwis bezpiecznego przechowywania hasła IMAP/SMTP (wzorzec z Oxill Mail / Mail as Notes):
 * 1. Preferuje natywne Obsidian SecretStorage API (Windows DPAPI / Keychain).
 * 2. Jeśli bieżąca wersja Obsidiana nie udostępnia jeszcze SecretStorage, używa lokalnego
 *    magazynu urządzenia (app.loadLocalStorage / saveLocalStorage) poza plikami synchronizowanymi
 *    z chmurą (OneDrive / Google Drive).
 * Hasło NIGDY nie jest zapisywane w data.json!
 */
export class SecretService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private getNativeSecretStorage(): ObsidianSecretStorageLike | null {
    const candidate = (this.app as unknown as { secretStorage?: ObsidianSecretStorageLike })
      .secretStorage;
    if (
      candidate &&
      typeof candidate.get === "function" &&
      typeof candidate.set === "function"
    ) {
      return candidate;
    }
    return null;
  }

  getStorageBackendLabel(): string {
    return this.getNativeSecretStorage()
      ? "Obsidian SecretStorage (Keychain / Windows DPAPI)"
      : "Lokalny magazyn urządzenia (poza OneDrive i data.json)";
  }

  async getMailPassword(): Promise<string> {
    const native = this.getNativeSecretStorage();
    if (native) {
      try {
        const val = await native.get(SECRET_KEY_MAIL_PASSWORD);
        if (typeof val === "string" && val.length > 0) return val;
      } catch {
        // fallback below
      }
    }

    const fallback = this.app.loadLocalStorage(FALLBACK_LOCAL_KEY);
    return typeof fallback === "string" ? fallback : "";
  }

  async setMailPassword(password: string): Promise<void> {
    const native = this.getNativeSecretStorage();
    if (native) {
      try {
        await native.set(SECRET_KEY_MAIL_PASSWORD, password);
        this.app.saveLocalStorage(FALLBACK_LOCAL_KEY, null);
        return;
      } catch {
        // fallback below
      }
    }
    this.app.saveLocalStorage(FALLBACK_LOCAL_KEY, password);
  }

  async clearMailPassword(): Promise<void> {
    const native = this.getNativeSecretStorage();
    if (native) {
      try {
        if (native.delete) {
          await native.delete(SECRET_KEY_MAIL_PASSWORD);
        } else {
          await native.set(SECRET_KEY_MAIL_PASSWORD, "");
        }
      } catch {
        // ignore
      }
    }
    this.app.saveLocalStorage(FALLBACK_LOCAL_KEY, null);
  }
}
