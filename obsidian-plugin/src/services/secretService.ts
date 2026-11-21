import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { App } from "obsidian";

interface ObsidianSecretStorageLike {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  delete?(key: string): Promise<void> | void;
}

interface ElectronSafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface GoogleOAuthTokenBundle {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  scope?: string;
}

const SECRET_KEY_MAIL_PASSWORD = "thunder-look-imap-password";
const SECRET_KEY_GOOGLE_OAUTH = "thunder-look-google-oauth";
const LEGACY_SECRET_KEY_MAIL_PASSWORD = "trinitec-mail-imap-password";
const LEGACY_PLAINTEXT_LOCAL_KEY = "trinitec-mail-local-secret-v1";
const ENCRYPTED_LOCAL_PREFIX = "thunder-look-enc-v2:";
const DEVICE_KEY_FILENAME = ".thunder-look-device.key";

/**
 * Wielowarstwowy, szyfrowany magazyn sekretów (NIGDY nie zapisuje haseł ani tokenów w data.json ani w chmurze):
 * 1. Natywne Obsidian SecretStorage API (Keychain / Windows DPAPI / libsecret).
 * 2. Natywne Electron safeStorage API (szyfrowane bloby per urządzenie w localStorage, poza data.json).
 * 3. Bezpieczny fallback AES-256-GCM z losowym 256-bitowym kluczem per urządzenie przechowywanym
 *    w katalogu domowym OS (poza synchronizowanym sejfem i data.json, uprawnienia 0600).
 */
export class SecretService {
  private app: App;
  private electronSafeStorageChecked = false;
  private electronSafeStorageCache: ElectronSafeStorageLike | null = null;

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

  private getElectronSafeStorage(): ElectronSafeStorageLike | null {
    if (this.electronSafeStorageChecked) {
      return this.electronSafeStorageCache;
    }
    this.electronSafeStorageChecked = true;
    try {
      const req = (window as unknown as { require?: (id: string) => unknown }).require;
      if (typeof req !== "function") return null;
      const electronMod = req("electron") as {
        safeStorage?: ElectronSafeStorageLike;
        remote?: { safeStorage?: ElectronSafeStorageLike };
      };
      const storage = electronMod?.safeStorage || electronMod?.remote?.safeStorage;
      if (
        storage &&
        typeof storage.isEncryptionAvailable === "function" &&
        typeof storage.encryptString === "function" &&
        typeof storage.decryptString === "function" &&
        storage.isEncryptionAvailable()
      ) {
        this.electronSafeStorageCache = storage;
        return storage;
      }
    } catch {
      // Electron safeStorage niedostępne w rendererze
    }
    return null;
  }

  private getOrCreateDeviceAesKey(): Buffer {
    const keyPath = path.join(os.homedir(), DEVICE_KEY_FILENAME);
    try {
      if (fs.existsSync(keyPath)) {
        const hex = fs.readFileSync(keyPath, "utf8").trim();
        if (/^[0-9a-f]{64}$/i.test(hex)) {
          return Buffer.from(hex, "hex");
        }
      }
    } catch {
      // Regenerate below if unreadable
    }

    const newKey = crypto.randomBytes(32);
    try {
      fs.writeFileSync(keyPath, newKey.toString("hex"), { encoding: "utf8", mode: 0o600 });
    } catch {
      // Jeśli brak uprawnień zapisu w homedir, klucz pozostanie per-sesja w pamięci
    }
    return newKey;
  }

  private encryptWithDeviceAes(plainText: string): string {
    const key = this.getOrCreateDeviceAesKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `aes256gcm:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
  }

  private decryptWithDeviceAes(payload: string): string | null {
    if (!payload.startsWith("aes256gcm:")) return null;
    const parts = payload.split(":");
    if (parts.length !== 4) return null;
    try {
      const key = this.getOrCreateDeviceAesKey();
      const iv = Buffer.from(parts[1], "base64");
      const tag = Buffer.from(parts[2], "base64");
      const data = Buffer.from(parts[3], "base64");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      return null;
    }
  }

  getStorageBackendLabel(): string {
    if (this.getNativeSecretStorage()) {
      return "Obsidian SecretStorage (Keychain / Windows DPAPI)";
    }
    if (this.getElectronSafeStorage()) {
      return "Electron safeStorage (szyfrowanie systemowe per urządzenie, poza data.json)";
    }
    return "Szyfrowany magazyn AES-256-GCM per urządzenie (poza data.json i OneDrive)";
  }

  private async getSecret(key: string, legacyKey?: string): Promise<string> {
    const native = this.getNativeSecretStorage();
    if (native) {
      try {
        const val = await native.get(key);
        if (typeof val === "string" && val.length > 0) return val;
        if (legacyKey) {
          const oldVal = await native.get(legacyKey);
          if (typeof oldVal === "string" && oldVal.length > 0) {
            await this.setSecret(key, oldVal);
            return oldVal;
          }
        }
      } catch {
        // Fallback below
      }
    }

    const storedBlob = this.app.loadLocalStorage(`${ENCRYPTED_LOCAL_PREFIX}${key}`);
    if (typeof storedBlob === "string" && storedBlob.length > 0) {
      if (storedBlob.startsWith("safeStorage:")) {
        const safe = this.getElectronSafeStorage();
        if (safe) {
          try {
            return safe.decryptString(Buffer.from(storedBlob.slice("safeStorage:".length), "base64"));
          } catch {
            return "";
          }
        }
      }
      if (storedBlob.startsWith("aes256gcm:")) {
        return this.decryptWithDeviceAes(storedBlob) ?? "";
      }
    }

    // Automatyczna migracja i usunięcie starego wpisu otwartym tekstem (z wersji przed audytem)
    if (key === SECRET_KEY_MAIL_PASSWORD) {
      const legacyPlain = this.app.loadLocalStorage(LEGACY_PLAINTEXT_LOCAL_KEY);
      if (typeof legacyPlain === "string" && legacyPlain.length > 0) {
        await this.setSecret(key, legacyPlain);
        this.app.saveLocalStorage(LEGACY_PLAINTEXT_LOCAL_KEY, null);
        return legacyPlain;
      }
    }

    return "";
  }

  private async setSecret(key: string, value: string): Promise<void> {
    const native = this.getNativeSecretStorage();
    if (native) {
      try {
        await native.set(key, value);
        this.app.saveLocalStorage(`${ENCRYPTED_LOCAL_PREFIX}${key}`, null);
        if (key === SECRET_KEY_MAIL_PASSWORD) {
          this.app.saveLocalStorage(LEGACY_PLAINTEXT_LOCAL_KEY, null);
        }
        return;
      } catch {
        // Fallback below
      }
    }

    const safe = this.getElectronSafeStorage();
    let storedWithSafeStorage = false;
    if (safe) {
      try {
        const encBuf = safe.encryptString(value);
        this.app.saveLocalStorage(
          `${ENCRYPTED_LOCAL_PREFIX}${key}`,
          `safeStorage:${encBuf.toString("base64")}`
        );
        storedWithSafeStorage = true;
      } catch {
        // Fallback na AES-256-GCM poniżej
      }
    }

    if (!storedWithSafeStorage) {
      const encAes = this.encryptWithDeviceAes(value);
      this.app.saveLocalStorage(`${ENCRYPTED_LOCAL_PREFIX}${key}`, encAes);
    }

    if (key === SECRET_KEY_MAIL_PASSWORD) {
      this.app.saveLocalStorage(LEGACY_PLAINTEXT_LOCAL_KEY, null);
    }
  }

  private async clearSecret(key: string, legacyKey?: string): Promise<void> {
    const native = this.getNativeSecretStorage();
    if (native) {
      for (const k of [key, legacyKey].filter((x): x is string => Boolean(x))) {
        try {
          if (native.delete) {
            await native.delete(k);
          } else {
            await native.set(k, "");
          }
        } catch {
          // ignore
        }
      }
    }
    this.app.saveLocalStorage(`${ENCRYPTED_LOCAL_PREFIX}${key}`, null);
    if (key === SECRET_KEY_MAIL_PASSWORD) {
      this.app.saveLocalStorage(LEGACY_PLAINTEXT_LOCAL_KEY, null);
    }
  }

  private mailPasswordKey(accountId?: string): string {
    const id = (accountId || "default").trim();
    return id === "default" ? SECRET_KEY_MAIL_PASSWORD : `${SECRET_KEY_MAIL_PASSWORD}:${id}`;
  }

  private googleOAuthKey(accountId?: string): string {
    const id = (accountId || "default").trim();
    return id === "default" ? SECRET_KEY_GOOGLE_OAUTH : `${SECRET_KEY_GOOGLE_OAUTH}:${id}`;
  }

  async getMailPassword(accountId?: string): Promise<string> {
    const isDefault = !accountId || accountId === "default";
    return this.getSecret(
      this.mailPasswordKey(accountId),
      isDefault ? LEGACY_SECRET_KEY_MAIL_PASSWORD : undefined
    );
  }

  async setMailPassword(password: string, accountId?: string): Promise<void> {
    await this.setSecret(this.mailPasswordKey(accountId), password);
  }

  async clearMailPassword(accountId?: string): Promise<void> {
    const isDefault = !accountId || accountId === "default";
    await this.clearSecret(
      this.mailPasswordKey(accountId),
      isDefault ? LEGACY_SECRET_KEY_MAIL_PASSWORD : undefined
    );
  }

  async getGoogleOAuthTokens(accountId?: string): Promise<GoogleOAuthTokenBundle | null> {
    const raw = await this.getSecret(this.googleOAuthKey(accountId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<GoogleOAuthTokenBundle>;
      if (typeof parsed.accessToken === "string" && typeof parsed.email === "string") {
        return {
          accessToken: parsed.accessToken,
          refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
          expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
          email: parsed.email,
          scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
        };
      }
    } catch {
      return null;
    }
    return null;
  }

  async setGoogleOAuthTokens(tokens: GoogleOAuthTokenBundle, accountId?: string): Promise<void> {
    await this.setSecret(this.googleOAuthKey(accountId), JSON.stringify(tokens));
  }

  async clearGoogleOAuthTokens(accountId?: string): Promise<void> {
    await this.clearSecret(this.googleOAuthKey(accountId));
  }
}
