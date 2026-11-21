import { ImapFolderSummary, ImapMessageHeader, ParsedEmailMessage } from "../types";
import { extractCleanSnippet } from "../utils/textUtils";

const DB_NAME = "thunder-look-cache-v3";
const DB_VERSION = 3;
const STORE_FOLDERS = "folderHeaders";
const STORE_FOLDER_LIST = "folderList";
const STORE_MESSAGES = "messageBodies";
const MAX_CACHED_MESSAGES_L2 = 200;
const MAX_CACHED_MESSAGES_L1 = 80;
const MAX_CACHED_ATTACHMENTS_L1 = 24;

interface CachedFolderRecord {
  key: string; // `${accountId}::${folder}`
  accountId: string;
  folder: string;
  uidValidity: string;
  uidNext?: number;
  totalOnServer?: number;
  updatedAt: number;
  headers: ImapMessageHeader[];
}

interface CachedFolderListRecord {
  key: string; // accountId
  updatedAt: number;
  folders: ImapFolderSummary[];
}

interface CachedMessageRecord {
  key: string; // `${accountId}::${folder}::${uid}`
  updatedAt: number;
  message: Omit<ParsedEmailMessage, "rawEmlBuffer" | "attachments"> & {
    attachmentStubs?: Array<{
      filename: string;
      contentType: string;
      size: number;
      partId?: string;
      lazy?: boolean;
    }>;
  };
}

export interface KnownAddressEntry {
  name: string;
  email: string;
  count: number;
}

/**
 * Dwupoziomowy cache (L1 RAM + L2 IndexedDB poza katalogiem sejfu):
 * - L1 RAM pozwala na natychmiastowe (<5 ms) przełączanie folderów i wiadomości (stale-while-revalidate).
 * - L2 IndexedDB zapewnia natychmiastowy start po uruchomieniu Obsidiana i pracę offline.
 * - Pełna izolacja kluczy per `accountId` dla obsługi wielu skrzynek pocztowych.
 */
export class MailCacheService {
  private dbPromise: Promise<IDBDatabase> | null = null;

  // L1 RAM caches
  private folderListRam = new Map<string, ImapFolderSummary[]>();
  private folderHeadersRam = new Map<string, CachedFolderRecord>();
  private messageRam = new Map<string, ParsedEmailMessage>();
  private attachmentPartRam = new Map<string, Buffer>();
  private knownAddresses = new Map<string, KnownAddressEntry>();

  private folderKey(folder: string, accountId = "default"): string {
    return `${accountId}::${folder}`;
  }

  private messageKey(folder: string, uid: number, accountId = "default"): string {
    return `${accountId}::${folder}::${uid}`;
  }

  private attachmentKey(
    folder: string,
    uid: number,
    partId: string,
    accountId = "default"
  ): string {
    return `${accountId}::${folder}::${uid}::${partId}`;
  }

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
          db.createObjectStore(STORE_FOLDERS, { keyPath: "key" });
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

  private recordAddress(name: string, email: string): void {
    const cleanEmail = (email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) return;
    const existing = this.knownAddresses.get(cleanEmail);
    const cleanName = (name || "").trim();
    if (existing) {
      existing.count += 1;
      if (cleanName && cleanName !== cleanEmail && (!existing.name || existing.name === cleanEmail)) {
        existing.name = cleanName;
      }
    } else {
      this.knownAddresses.set(cleanEmail, {
        name: cleanName && cleanName !== cleanEmail ? cleanName : "",
        email: cleanEmail,
        count: 1,
      });
    }
  }

  private harvestAddresses(headers: ImapMessageHeader[]): void {
    for (const h of headers) {
      this.recordAddress(h.fromName, h.fromEmail);
      if (h.toEmail) this.recordAddress("", h.toEmail);
    }
  }

  getKnownEmailAddresses(): KnownAddressEntry[] {
    return Array.from(this.knownAddresses.values()).sort((a, b) => b.count - a.count);
  }

  // --- Synchronous L1 RAM getters (< 1 ms) ---

  getFolderListSync(accountId = "default"): ImapFolderSummary[] | null {
    return this.folderListRam.get(accountId) ?? null;
  }

  getFolderRecordSync(folder: string, accountId = "default"): CachedFolderRecord | null {
    return this.folderHeadersRam.get(this.folderKey(folder, accountId)) ?? null;
  }

  getFolderHeadersSync(folder: string, accountId = "default"): ImapMessageHeader[] | null {
    return this.folderHeadersRam.get(this.folderKey(folder, accountId))?.headers ?? null;
  }

  getCachedMessageSync(
    folder: string,
    uid: number,
    accountId = "default"
  ): ParsedEmailMessage | null {
    return this.messageRam.get(this.messageKey(folder, uid, accountId)) ?? null;
  }

  getCachedAttachmentPart(
    folder: string,
    uid: number,
    partId: string,
    accountId = "default"
  ): Buffer | null {
    return this.attachmentPartRam.get(this.attachmentKey(folder, uid, partId, accountId)) ?? null;
  }

  setCachedAttachmentPart(
    folder: string,
    uid: number,
    partId: string,
    buf: Buffer,
    accountId = "default"
  ): void {
    const key = this.attachmentKey(folder, uid, partId, accountId);
    this.attachmentPartRam.delete(key);
    this.attachmentPartRam.set(key, buf);
    if (this.attachmentPartRam.size > MAX_CACHED_ATTACHMENTS_L1) {
      const oldest = this.attachmentPartRam.keys().next().value;
      if (oldest) this.attachmentPartRam.delete(oldest);
    }
  }

  // --- Async L1 + L2 operations ---

  async getFolderList(accountId = "default"): Promise<ImapFolderSummary[] | null> {
    const ram = this.folderListRam.get(accountId);
    if (ram && ram.length > 0) return ram;
    try {
      const db = await this.openDb();
      const loaded = await new Promise<ImapFolderSummary[] | null>((resolve) => {
        const tx = db.transaction(STORE_FOLDER_LIST, "readonly");
        const req = tx.objectStore(STORE_FOLDER_LIST).get(accountId);
        req.onsuccess = () => {
          const rec = req.result as CachedFolderListRecord | undefined;
          resolve(rec?.folders ?? null);
        };
        req.onerror = () => resolve(null);
      });
      if (loaded) this.folderListRam.set(accountId, loaded);
      return loaded;
    } catch {
      return null;
    }
  }

  async setFolderList(folders: ImapFolderSummary[], accountId = "default"): Promise<void> {
    this.folderListRam.set(accountId, folders);
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDER_LIST, "readwrite");
        const record: CachedFolderListRecord = {
          key: accountId,
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

  async getFolderRecord(
    folder: string,
    accountId = "default",
    expectedUidValidity?: string
  ): Promise<CachedFolderRecord | null> {
    const k = this.folderKey(folder, accountId);
    const ram = this.folderHeadersRam.get(k);
    if (ram) {
      if (expectedUidValidity && ram.uidValidity !== expectedUidValidity) {
        return null;
      }
      return ram;
    }
    try {
      const db = await this.openDb();
      const rec = await new Promise<CachedFolderRecord | null>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readonly");
        const req = tx.objectStore(STORE_FOLDERS).get(k);
        req.onsuccess = () => {
          const found = req.result as CachedFolderRecord | undefined;
          if (!found) {
            resolve(null);
            return;
          }
          if (expectedUidValidity && found.uidValidity !== expectedUidValidity) {
            resolve(null);
            return;
          }
          resolve(found);
        };
        req.onerror = () => resolve(null);
      });
      if (rec) {
        this.folderHeadersRam.set(k, rec);
        this.harvestAddresses(rec.headers);
      }
      return rec;
    } catch {
      return null;
    }
  }

  async getFolderHeaders(
    folder: string,
    expectedUidValidity?: string,
    accountId = "default"
  ): Promise<ImapMessageHeader[] | null> {
    const rec = await this.getFolderRecord(folder, accountId, expectedUidValidity);
    return rec?.headers ?? null;
  }

  async getAllCachedHeaders(maxItems = 200, accountId?: string): Promise<ImapMessageHeader[]> {
    const merged: ImapMessageHeader[] = [];
    const seen = new Set<string>();

    const pushFrom = (rec: CachedFolderRecord) => {
      if (accountId && rec.accountId !== accountId) return;
      for (const h of rec.headers) {
        const id = `${rec.accountId}::${h.folder}::${h.uid}`;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(h);
        if (merged.length >= maxItems) return;
      }
    };

    for (const rec of this.folderHeadersRam.values()) {
      pushFrom(rec);
      if (merged.length >= maxItems) return merged;
    }

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readonly");
        const req = tx.objectStore(STORE_FOLDERS).getAll();
        req.onsuccess = () => {
          const records = (req.result as CachedFolderRecord[]) || [];
          for (const rec of records) {
            this.harvestAddresses(rec.headers);
            pushFrom(rec);
            if (merged.length >= maxItems) break;
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
    return merged;
  }

  async setFolderHeaders(
    folder: string,
    uidValidity: string,
    headers: ImapMessageHeader[],
    accountId = "default",
    meta?: { uidNext?: number; totalOnServer?: number }
  ): Promise<void> {
    const k = this.folderKey(folder, accountId);
    const existing = this.folderHeadersRam.get(k);
    const record: CachedFolderRecord = {
      key: k,
      accountId,
      folder,
      uidValidity,
      uidNext: meta?.uidNext ?? existing?.uidNext,
      totalOnServer: meta?.totalOnServer ?? existing?.totalOnServer,
      updatedAt: Date.now(),
      headers,
    };
    this.folderHeadersRam.set(k, record);
    this.harvestAddresses(headers);

    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readwrite");
        tx.objectStore(STORE_FOLDERS).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Cache opcjonalny
    }
  }

  /**
   * Scala nowe lub starsze strony nagłówków z istniejącym cache (deduplikacja po UID, sort malejąco po UID).
   */
  async mergeFolderHeaders(
    folder: string,
    uidValidity: string,
    incoming: ImapMessageHeader[],
    accountId = "default",
    meta?: { uidNext?: number; totalOnServer?: number }
  ): Promise<ImapMessageHeader[]> {
    const existing = await this.getFolderRecord(folder, accountId, uidValidity);
    const byUid = new Map<number, ImapMessageHeader>();
    if (existing) {
      for (const h of existing.headers) byUid.set(h.uid, h);
    }
    for (const h of incoming) {
      const prev = byUid.get(h.uid);
      byUid.set(h.uid, prev ? { ...prev, ...h, snippet: h.snippet || prev.snippet } : h);
    }
    const merged = Array.from(byUid.values()).sort((a, b) => b.uid - a.uid);
    await this.setFolderHeaders(folder, uidValidity, merged, accountId, meta);
    return merged;
  }

  /**
   * Optymistyczna aktualizacja nagłówków w cache (np. toggle \Seen, \Flagged, dodanie snippetu).
   */
  async mutateHeadersInCache(
    folder: string,
    accountId: string,
    mutator: (headers: ImapMessageHeader[]) => ImapMessageHeader[]
  ): Promise<ImapMessageHeader[]> {
    const existing = await this.getFolderRecord(folder, accountId);
    if (!existing) return [];
    const next = mutator(existing.headers);
    await this.setFolderHeaders(folder, existing.uidValidity, next, accountId, {
      uidNext: existing.uidNext,
      totalOnServer: existing.totalOnServer,
    });
    return next;
  }

  /**
   * Optymistyczne usunięcie UID z cache po usunięciu/przeniesieniu.
   */
  async removeHeadersFromCache(
    folder: string,
    uids: number[],
    accountId = "default"
  ): Promise<void> {
    const uidSet = new Set(uids);
    await this.mutateHeadersInCache(folder, accountId, (headers) =>
      headers.filter((h) => !uidSet.has(h.uid))
    );
    for (const uid of uids) {
      this.messageRam.delete(this.messageKey(folder, uid, accountId));
    }
  }

  updateFolderSummaryCount(
    folder: string,
    deltaMessages: number,
    deltaUnseen: number,
    accountId = "default"
  ): void {
    const list = this.folderListRam.get(accountId);
    if (!list) return;
    const updated = list.map((f) =>
      f.path === folder
        ? {
            ...f,
            messages: Math.max(0, f.messages + deltaMessages),
            unseen: Math.max(0, f.unseen + deltaUnseen),
          }
        : f
    );
    this.folderListRam.set(accountId, updated);
  }

  async cacheParsedMessage(msg: ParsedEmailMessage, accountId = "default"): Promise<void> {
    if (!msg.folder || msg.uid === undefined) return;
    const accId = msg.accountId || accountId;
    const key = this.messageKey(msg.folder, msg.uid, accId);

    // L1 RAM (z pełnymi załącznikami i buforem EML dla natychmiastowego powrotu)
    this.messageRam.delete(key);
    this.messageRam.set(key, msg);
    if (this.messageRam.size > MAX_CACHED_MESSAGES_L1) {
      const oldest = this.messageRam.keys().next().value;
      if (oldest) this.messageRam.delete(oldest);
    }

    // Zapisz czysty snippet w nagłówku cache (bez śmieci HTML/encjami/artefaktami obrazków)
    const rawSnippet = extractCleanSnippet(
      msg.strippedMarkdownBody || msg.textBody || msg.htmlBody || "",
      110
    );
    if (rawSnippet) {
      void this.mutateHeadersInCache(msg.folder, accId, (headers) =>
        headers.map((h) => (h.uid === msg.uid ? { ...h, snippet: rawSnippet } : h))
      );
    }

    try {
      const db = await this.openDb();
      const { rawEmlBuffer: _raw, attachments, ...lightMessage } = msg;
      const record: CachedMessageRecord = {
        key,
        updatedAt: Date.now(),
        message: {
          ...lightMessage,
          attachmentStubs: (attachments || []).map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
            partId: a.partId,
            lazy: true,
          })),
        },
      };
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_MESSAGES, "readwrite");
        const store = tx.objectStore(STORE_MESSAGES);
        store.put(record);
        const allReq = store.getAll();
        allReq.onsuccess = () => {
          const items = (allReq.result as CachedMessageRecord[]) || [];
          if (items.length > MAX_CACHED_MESSAGES_L2) {
            items.sort((a, b) => a.updatedAt - b.updatedAt);
            const toRemove = items.slice(0, items.length - MAX_CACHED_MESSAGES_L2);
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

  async getCachedMessage(
    folder: string,
    uid: number,
    accountId = "default"
  ): Promise<ParsedEmailMessage | null> {
    const key = this.messageKey(folder, uid, accountId);
    const ram = this.messageRam.get(key);
    if (ram) return ram;

    try {
      const db = await this.openDb();
      const loaded = await new Promise<ParsedEmailMessage | null>((resolve) => {
        const tx = db.transaction(STORE_MESSAGES, "readonly");
        const req = tx.objectStore(STORE_MESSAGES).get(key);
        req.onsuccess = () => {
          const rec = req.result as CachedMessageRecord | undefined;
          if (!rec) {
            resolve(null);
            return;
          }
          const { attachmentStubs, ...rest } = rec.message;
          resolve({
            ...rest,
            attachments: (attachmentStubs || []).map((s) => ({
              filename: s.filename,
              contentType: s.contentType,
              size: s.size,
              partId: s.partId,
              lazy: true,
              content: Buffer.alloc(0),
            })),
          });
        };
        req.onerror = () => resolve(null);
      });
      if (loaded) this.messageRam.set(key, loaded);
      return loaded;
    } catch {
      return null;
    }
  }

  async clearFolder(folder: string, accountId = "default"): Promise<void> {
    const k = this.folderKey(folder, accountId);
    this.folderHeadersRam.delete(k);
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FOLDERS, "readwrite");
        tx.objectStore(STORE_FOLDERS).delete(k);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
  }

  clearRamForAccount(accountId: string): void {
    this.folderListRam.delete(accountId);
    const prefix = `${accountId}::`;
    for (const k of Array.from(this.folderHeadersRam.keys())) {
      if (k.startsWith(prefix)) this.folderHeadersRam.delete(k);
    }
    for (const k of Array.from(this.messageRam.keys())) {
      if (k.startsWith(prefix)) this.messageRam.delete(k);
    }
    for (const k of Array.from(this.attachmentPartRam.keys())) {
      if (k.startsWith(prefix)) this.attachmentPartRam.delete(k);
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
