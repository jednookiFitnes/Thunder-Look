import { ImapFolderSummary, ImapMessageHeader, ParsedEmailMessage } from "../types";

const DB_NAME = "thunder-look-cache-v2";
const DB_VERSION = 2;
const STORE_FOLDERS = "folderHeaders";
const STORE_FOLDER_LIST = "folderList";
const STORE_MESSAGES = "messageBodies";
const MAX_CACHED_MESSAGES = 80;

interface CachedFolderRecord {
  folder: string;
  uidValidity: string;
  updatedAt: number;
  headers: ImapMessageHeader[];
}

interface CachedFolderListRecord {
  key: "all";
  updatedAt: number;
  folders: ImapFolderSummary[];
}

interface CachedMessageRecord {
  key: string; // `${folder}::${uid}`
  updatedAt: number;
  message: Omit<ParsedEmailMessage, "rawEmlBuffer" | "attachments">;
}

/**
 * Lokalny cache IndexedDB poza katalogiem sejfu (poza OneDrive / Google Drive):
 * - Przechowuje listę folderów, nagłówki (z walidacją RFC 3501 UIDVALIDITY) oraz ostatnio czytane treści.
 * - Umożliwia przeglądanie offline oraz podgląd na żywo reguł kategoryzacji AI bez zapytań do serwera IMAP.
 */
export class MailCacheService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB niedostępne w tym środowisku."));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          db.createObjectStore(STORE_FOLDERS, { keyPath: "folder" });
        }
        if (!db.objectStoreNames.contains(STORE_FOLDER_LIST)) {
          db.createObjectStore(STORE_FOLDER_LIST, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          db.createObjectStore(STORE_MESSAGES, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Błąd otwierania IndexedDB"));
    });
    return this.dbPromise;
  }

  async getFolderList(): Promise<ImapFolderSummary[] | null> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_FOLDER_LIST, "readonly");
        const req = tx.objectStore(STORE_FOLDER_LIST).get("all");
        req.onsuccess = () => {
          const rec = req.result as CachedFolderListRecord | undefined;
          resolve(rec?.folders ?? null);
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async setFolderList(folders: ImapFolderSummary[]): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDER_LIST, "readwrite");
        const record: CachedFolderListRecord = {
          key: "all",
          updatedAt: Date.now(),
          folders,
        };
        tx.objectStore(STORE_FOLDER_LIST).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Cache opcjonalny
    }
  }

  async getFolderHeaders(
    folder: string,
    expectedUidValidity?: string
  ): Promise<ImapMessageHeader[] | null> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readonly");
        const req = tx.objectStore(STORE_FOLDERS).get(folder);
        req.onsuccess = () => {
          const rec = req.result as CachedFolderRecord | undefined;
          if (!rec) {
            resolve(null);
            return;
          }
          if (expectedUidValidity && rec.uidValidity !== expectedUidValidity) {
            resolve(null);
            return;
          }
          resolve(rec.headers);
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async getAllCachedHeaders(maxItems = 120): Promise<ImapMessageHeader[]> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readonly");
        const req = tx.objectStore(STORE_FOLDERS).getAll();
        req.onsuccess = () => {
          const records = (req.result as CachedFolderRecord[]) || [];
          const merged: ImapMessageHeader[] = [];
          for (const rec of records) {
            for (const h of rec.headers) {
              merged.push(h);
              if (merged.length >= maxItems) {
                resolve(merged);
                return;
              }
            }
          }
          resolve(merged);
        };
        req.onerror = () => resolve([]);
      });
    } catch {
      return [];
    }
  }

  async setFolderHeaders(
    folder: string,
    uidValidity: string,
    headers: ImapMessageHeader[]
  ): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readwrite");
        const record: CachedFolderRecord = {
          folder,
          uidValidity,
          updatedAt: Date.now(),
          headers,
        };
        tx.objectStore(STORE_FOLDERS).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Cache opcjonalny
    }
  }

  async cacheParsedMessage(msg: ParsedEmailMessage): Promise<void> {
    if (!msg.folder || msg.uid === undefined) return;
    try {
      const db = await this.openDb();
      const { rawEmlBuffer: _raw, attachments: _atts, ...lightMessage } = msg;
      const record: CachedMessageRecord = {
        key: `${msg.folder}::${msg.uid}`,
        updatedAt: Date.now(),
        message: lightMessage,
      };
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_MESSAGES, "readwrite");
        const store = tx.objectStore(STORE_MESSAGES);
        store.put(record);
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const items = (allReq.result as CachedMessageRecord[]) || [];
          if (items.length > MAX_CACHED_MESSAGES) {
            items.sort((a, b) => a.updatedAt - b.updatedAt);
            const toRemove = items.slice(0, items.length - MAX_CACHED_MESSAGES);
            for (const old of toRemove) {
              store.delete(old.key);
            }
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
  }

  async getCachedMessage(folder: string, uid: number): Promise<ParsedEmailMessage | null> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_MESSAGES, "readonly");
        const req = tx.objectStore(STORE_MESSAGES).get(`${folder}::${uid}`);
        req.onsuccess = () => {
          const rec = req.result as CachedMessageRecord | undefined;
          if (!rec) {
            resolve(null);
            return;
          }
          resolve({
            ...rec.message,
            attachments: [],
          });
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async clearFolder(folder: string): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readwrite");
        tx.objectStore(STORE_FOLDERS).delete(folder);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
  }

  close(): void {
    if (!this.dbPromise) return;
    const pending = this.dbPromise;
    this.dbPromise = null;
    pending
      .then((db) => db.close())
      .catch(() => {
        // ignore
      });
  }
}
