import { ImapMessageHeader } from "../types";

const DB_NAME = "trinitec-mail-cache-v1";
const STORE_FOLDERS = "folderHeaders";

interface CachedFolderRecord {
  folder: string;
  uidValidity: string;
  updatedAt: number;
  headers: ImapMessageHeader[];
}

/**
 * Lokalny cache IndexedDB poza katalogiem sejfu (wzorzec z Oxill Mail):
 * - Brak jakichkolwiek zapisów w synchronizowanym folderze OneDrive / Google Drive.
 * - Zgodnie z RFC 3501 każdy folder jest walidowany po UIDVALIDITY: zmiana UIDVALIDITY
 *   natychmiast unieważnia stary cache folderu, zapobiegając działaniu na błędnych UID.
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
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          db.createObjectStore(STORE_FOLDERS, { keyPath: "folder" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("Błąd otwierania IndexedDB"));
    });
    return this.dbPromise;
  }

  async getFolderHeaders(
    folder: string,
    expectedUidValidity?: string
  ): Promise<ImapMessageHeader[] | null> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readonly");
        const store = tx.objectStore(STORE_FOLDERS);
        const req = store.get(folder);
        req.onsuccess = () => {
          const rec = req.result as CachedFolderRecord | undefined;
          if (!rec) {
            resolve(null);
            return;
          }
          // RFC 3501: Unieważnij cache, jeśli serwer zmienił UIDVALIDITY
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

  async setFolderHeaders(
    folder: string,
    uidValidity: string,
    headers: ImapMessageHeader[]
  ): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readwrite");
        const store = tx.objectStore(STORE_FOLDERS);
        const record: CachedFolderRecord = {
          folder,
          uidValidity,
          updatedAt: Date.now(),
          headers,
        };
        store.put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Cache jest opcjonalny — nie blokuje pracy wtyczki
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
