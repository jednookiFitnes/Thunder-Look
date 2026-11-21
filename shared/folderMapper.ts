import { naturalCompare } from "./textUtils.js";
import { isGmailHostname, isOutlookHostname } from "./networkSecurity.js";

export type SpecialFolderRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "spam"
  | "trash"
  | "starred"
  | "all"
  | "custom";

export interface FolderDescriptor {
  path: string;
  specialUse?: string;
  delimiter?: string;
  messages: number;
  unseen: number;
  uidValidity: string;
  uidNext?: number;
  role?: SpecialFolderRole;
}

export interface SpecialFoldersMap {
  inbox: string;
  sent: string | null;
  drafts: string | null;
  archive: string | null;
  spam: string | null;
  trash: string | null;
  starred: string | null;
  all: string | null;
}

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  folder: FolderDescriptor | null;
  role: SpecialFolderRole;
  isSystem: boolean;
  children: FolderTreeNode[];
  totalUnseen: number;
}

const SPECIAL_USE_MAP: Record<string, SpecialFolderRole> = {
  "\\inbox": "inbox",
  "\\sent": "sent",
  "\\drafts": "drafts",
  "\\archive": "archive",
  "\\junk": "spam",
  "\\trash": "trash",
  "\\flagged": "starred",
  "\\all": "all",
};

const ROLE_ORDER: Record<SpecialFolderRole, number> = {
  inbox: 0,
  starred: 1,
  sent: 2,
  drafts: 3,
  archive: 4,
  all: 5,
  spam: 6,
  trash: 7,
  custom: 99,
};

/**
 * Wykrywa rolę folderu specjalnego dla Gmaila (PL/EN), Outlook/Office 365 (PL/EN)
 * oraz Roundcube/Dovecot/Cyrus (PL/EN).
 */
export function detectFolderRole(path: string, specialUse?: string): SpecialFolderRole {
  const su = String(specialUse || "").trim().toLowerCase();
  if (su && SPECIAL_USE_MAP[su]) {
    return SPECIAL_USE_MAP[su];
  }

  const p = String(path || "").trim();
  const lower = p.toLowerCase();
  const leaf = lower.split(/[/.]/).pop() || lower;

  if (lower === "inbox" || leaf === "odebrane") return "inbox";

  if (
    /^\[gmail\]\/(sent mail|wysłane|wyslane)$/i.test(p) ||
    /^(inbox[/.])?(sent|sent items|sent messages|wysłane|wyslane|elementy wysłane)$/i.test(p) ||
    leaf === "sent" ||
    leaf === "sent items" ||
    leaf === "wysłane" ||
    leaf === "wyslane"
  ) {
    return "sent";
  }

  if (
    /^\[gmail\]\/(drafts|wersje robocze|szkice)$/i.test(p) ||
    /^(inbox[/.])?(drafts|wersje robocze|szkice|kopie robocze)$/i.test(p) ||
    leaf === "drafts" ||
    leaf === "wersje robocze" ||
    leaf === "szkice"
  ) {
    return "drafts";
  }

  if (
    /^\[gmail\]\/(trash|bin|kosz)$/i.test(p) ||
    /^(inbox[/.])?(trash|deleted|deleted items|deleted messages|kosz|elementy usunięte|usunięte)$/i.test(
      p
    ) ||
    leaf === "trash" ||
    leaf === "deleted items" ||
    leaf === "kosz" ||
    leaf === "elementy usunięte"
  ) {
    return "trash";
  }

  if (
    /^\[gmail\]\/(spam|junk)$/i.test(p) ||
    /^(inbox[/.])?(spam|junk|junk email|junk e-mail|niechciana poczta|wiadomości-śmieci)$/i.test(
      p
    ) ||
    leaf === "spam" ||
    leaf === "junk" ||
    leaf === "junk email" ||
    leaf === "niechciana poczta"
  ) {
    return "spam";
  }

  if (
    /^\[gmail\]\/(all mail|wszystkie|wszystkie wiadomości)$/i.test(p) ||
    leaf === "all mail" ||
    leaf === "wszystkie" ||
    leaf === "wszystkie wiadomości"
  ) {
    return "all";
  }

  if (
    /^\[gmail\]\/(starred|oznaczone gwiazdką|z gwiazdką)$/i.test(p) ||
    leaf === "starred" ||
    leaf === "oznaczone gwiazdką"
  ) {
    return "starred";
  }

  if (
    /^(inbox[/.])?(archive|archiwum|archives)$/i.test(p) ||
    leaf === "archive" ||
    leaf === "archiwum"
  ) {
    return "archive";
  }

  return "custom";
}

/**
 * Zwraca mapę folderów specjalnych (Inbox, Sent, Drafts, Archive, Spam, Trash, Starred, All)
 * z inteligentnymi wartościami domyślnymi dla Gmaila, Outlooka i Roundcube.
 */
export function resolveSpecialFolders(
  folders: FolderDescriptor[],
  host = "",
  configured?: {
    inboxFolder?: string;
    sentFolder?: string;
    draftsFolder?: string;
    archiveFolder?: string;
    spamFolder?: string;
    trashFolder?: string;
  }
): SpecialFoldersMap {
  const byRole = new Map<SpecialFolderRole, string>();
  for (const f of folders) {
    const role = f.role ?? detectFolderRole(f.path, f.specialUse);
    if (role !== "custom" && !byRole.has(role)) {
      byRole.set(role, f.path);
    }
  }

  const isGmail = isGmailHostname(host);
  const isOutlook = isOutlookHostname(host);

  const inbox = byRole.get("inbox") || configured?.inboxFolder || "INBOX";
  const all = byRole.get("all") || (isGmail ? "[Gmail]/All Mail" : null);
  const sent =
    byRole.get("sent") ||
    configured?.sentFolder ||
    (isGmail ? "[Gmail]/Sent Mail" : isOutlook ? "Sent Items" : "Sent");
  const drafts =
    byRole.get("drafts") ||
    configured?.draftsFolder ||
    (isGmail ? "[Gmail]/Drafts" : "Drafts");
  const trash =
    byRole.get("trash") ||
    configured?.trashFolder ||
    (isGmail ? "[Gmail]/Trash" : isOutlook ? "Deleted Items" : "Trash");
  const spam =
    byRole.get("spam") ||
    configured?.spamFolder ||
    (isGmail ? "[Gmail]/Spam" : isOutlook ? "Junk Email" : "Junk");
  const archive =
    byRole.get("archive") ||
    (isGmail ? all : null) ||
    configured?.archiveFolder ||
    "Archive";
  const starred = byRole.get("starred") || null;

  return { inbox, sent, drafts, archive, spam, trash, starred, all };
}

/**
 * Chroni foldery systemowe przed przypadkowym usunięciem lub zmianą nazwy.
 */
export function isSystemFolder(path: string, specialUse?: string): boolean {
  const role = detectFolderRole(path, specialUse);
  if (role !== "custom") return true;
  return /^\[gmail\]$/i.test(String(path || "").trim());
}

/**
 * Waliduje nazwę tworzonego/zmienianego folderu IMAP.
 */
export function validateImapFolderName(name: string): string | null {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "Nazwa folderu nie może być pusta.";
  if (trimmed.length > 120) return "Nazwa folderu jest zbyt długa (maks. 120 znaków).";
  if (/[\r\n\0*%]/.test(trimmed)) {
    return "Nazwa folderu zawiera niedozwolone znaki IMAP (*, %, CR/LF).";
  }
  if (trimmed.includes("..")) {
    return "Nazwa folderu nie może zawierać sekwencji „..”.";
  }
  return null;
}

function scoreSystemFolderCandidate(f: FolderDescriptor, role: SpecialFolderRole): number {
  let score = 0;
  const su = String(f.specialUse || "").trim().toLowerCase();
  if (su && SPECIAL_USE_MAP[su] === role) score += 100;
  const p = String(f.path || "").trim();
  if (role === "inbox" && p.toLowerCase() === "inbox") score += 40;
  if (/^\[gmail\]\//i.test(p)) score += 25;
  if (f.messages > 0) score += 5;
  if (f.unseen > 0) score += 2;
  // Preferuj krótszą, kanoniczną ścieżkę przy remisie
  score -= Math.min(p.length, 60) * 0.01;
  return score;
}

/**
 * Buduje hierarchiczne drzewko folderów:
 * - Foldery systemowe (Odebrane, Gwiazdkowane, Wysłane, Szkice, Archiwum, Wszystkie, Spam, Kosz) przypięte u góry —
 *   MAKSYMALNIE JEDEN kanoniczny folder na każdą rolę (bez duplikatów typu podwójne „Szkice”).
 * - Nadmiarowe foldery o podobnej nazwie (np. stary „Wersje robocze” obok „[Gmail]/Wersje robocze”)
 *   trafiają do sekcji customNodes pod swoją oryginalną nazwą IMAP.
 * - Zagnieżdżone podfoldery (`INBOX/!zakupy/ps5 - michal`) zgrupowane jako zwijane węzły.
 */
export function buildFolderTree(folders: FolderDescriptor[]): {
  systemNodes: FolderTreeNode[];
  customNodes: FolderTreeNode[];
} {
  // 1. Deduplikacja po dokładnej ścieżce (case-sensitive, z fallbackiem dla INBOX)
  const uniqueByPath = new Map<string, FolderDescriptor>();
  for (const f of folders) {
    const cleanPath = String(f.path || "").trim();
    if (!cleanPath) continue;
    const pathKey = cleanPath.toLowerCase() === "inbox" ? "inbox" : cleanPath;
    const prev = uniqueByPath.get(pathKey);
    if (!prev || (f.specialUse && !prev.specialUse) || f.messages > prev.messages) {
      uniqueByPath.set(pathKey, f);
    }
  }

  const deduped = Array.from(uniqueByPath.values());
  const roleCandidates = new Map<SpecialFolderRole, FolderDescriptor[]>();
  const customFolders: FolderDescriptor[] = [];

  for (const f of deduped) {
    const role = f.role ?? detectFolderRole(f.path, f.specialUse);
    if (role !== "custom") {
      const list = roleCandidates.get(role) || [];
      list.push({ ...f, role });
      roleCandidates.set(role, list);
    } else {
      customFolders.push({ ...f, role: "custom" });
    }
  }

  // 2. Dla każdej roli specjalnej wybierz dokładnie 1 kanoniczny folder; resztę przenieś do FOLDERY
  const systemNodes: FolderTreeNode[] = [];
  for (const [role, candidates] of roleCandidates.entries()) {
    candidates.sort((a, b) => scoreSystemFolderCandidate(b, role) - scoreSystemFolderCandidate(a, role));
    const winner = candidates[0];
    systemNodes.push({
      name: formatSystemFolderLabel(winner.path, role),
      fullPath: winner.path,
      folder: { ...winner, role },
      role,
      isSystem: true,
      children: [],
      totalUnseen: winner.unseen,
    });

    for (let i = 1; i < candidates.length; i++) {
      customFolders.push({ ...candidates[i], role: "custom" });
    }
  }

  systemNodes.sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);

  const rootMap = new Map<string, FolderTreeNode>();
  const getOrCreateChild = (
    parentMap: Map<string, FolderTreeNode>,
    name: string,
    fullPath: string
  ): FolderTreeNode => {
    let existing = parentMap.get(name);
    if (!existing) {
      existing = {
        name,
        fullPath,
        folder: null,
        role: "custom",
        isSystem: false,
        children: [],
        totalUnseen: 0,
      };
      parentMap.set(name, existing);
    }
    return existing;
  };

  for (const f of customFolders) {
    const delimiter = f.delimiter || (f.path.includes("/") ? "/" : ".");
    const rawParts = f.path.split(delimiter).filter(Boolean);
    // Jeśli folder to podfolder INBOX (np. INBOX/!zakupy/ps5), zdejmij techniczny prefiks INBOX z korzenia drzewka
    const displayParts =
      rawParts.length > 1 && rawParts[0].toLowerCase() === "inbox"
        ? rawParts.slice(1)
        : rawParts;
    const prefix =
      rawParts.length > 1 && rawParts[0].toLowerCase() === "inbox"
        ? rawParts[0] + delimiter
        : "";

    let currentMap = rootMap;
    let currentPath = prefix;

    for (let i = 0; i < displayParts.length; i++) {
      const seg = displayParts[i];
      currentPath = currentPath && !currentPath.endsWith(delimiter)
        ? `${currentPath}${delimiter}${seg}`
        : `${currentPath}${seg}`;
      const node = getOrCreateChild(currentMap, seg, currentPath);
      if (i === displayParts.length - 1) {
        node.folder = f;
        node.fullPath = f.path;
      }
      const nextMap = new Map<string, FolderTreeNode>();
      for (const c of node.children) nextMap.set(c.name, c);
      // Powiąż referencję dziecka po utworzeniu
      if (i < displayParts.length - 1) {
        const nextSeg = displayParts[i + 1];
        const nextPath = `${currentPath}${delimiter}${nextSeg}`;
        if (!nextMap.has(nextSeg)) {
          const created: FolderTreeNode = {
            name: nextSeg,
            fullPath: nextPath,
            folder: null,
            role: "custom",
            isSystem: false,
            children: [],
            totalUnseen: 0,
          };
          node.children.push(created);
          nextMap.set(nextSeg, created);
        }
        currentMap = nextMap;
      }
    }
  }

  const finalize = (nodes: FolderTreeNode[]): FolderTreeNode[] => {
    nodes.sort((a, b) => naturalCompare(a.name, b.name));
    for (const n of nodes) {
      n.children = finalize(n.children);
      const childUnseen = n.children.reduce((acc, c) => acc + c.totalUnseen, 0);
      n.totalUnseen = (n.folder?.unseen || 0) + childUnseen;
    }
    return nodes;
  };

  return {
    systemNodes,
    customNodes: finalize(Array.from(rootMap.values())),
  };
}

export function formatSystemFolderLabel(path: string, role: SpecialFolderRole): string {
  switch (role) {
    case "inbox":
      return "Odebrane";
    case "sent":
      return "Wysłane";
    case "drafts":
      return "Szkice";
    case "archive":
      return "Archiwum";
    case "spam":
      return "Spam";
    case "trash":
      return "Kosz";
    case "starred":
      return "Z gwiazdką";
    case "all":
      return "Wszystkie";
    default:
      return path;
  }
}

// ============================================================================
// Wyszukiwanie strukturalne (lokalne + natywne IMAP SEARCH + Gmail X-GM-RAW)
// ============================================================================

export interface ParsedSearchQuery {
  raw: string;
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  before?: string; // YYYY-MM-DD
  after?: string; // YYYY-MM-DD
  freeText: string;
}

export function parseSearchQuery(rawQuery: string): ParsedSearchQuery {
  const raw = String(rawQuery || "").trim();
  const parsed: ParsedSearchQuery = { raw, freeText: "" };
  if (!raw) return parsed;

  const tokenRx = /([a-z]+):(?:"([^"]+)"|(\S+))|(?:"([^"]+)"|(\S+))/gi;
  const freeTokens: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tokenRx.exec(raw)) !== null) {
    const key = match[1]?.toLowerCase();
    const val = (match[2] ?? match[3] ?? "").trim();
    const plain = (match[4] ?? match[5] ?? "").trim();

    if (key && val) {
      if (key === "from") parsed.from = val;
      else if (key === "to") parsed.to = val;
      else if (key === "subject") parsed.subject = val;
      else if (key === "has" && val.toLowerCase().startsWith("attach")) parsed.hasAttachment = true;
      else if (key === "is" && val.toLowerCase() === "unread") parsed.isUnread = true;
      else if (key === "is" && (val.toLowerCase() === "starred" || val.toLowerCase() === "flagged")) {
        parsed.isStarred = true;
      } else if (key === "before" && /^\d{4}-\d{2}-\d{2}$/.test(val)) parsed.before = val;
      else if (key === "after" && /^\d{4}-\d{2}-\d{2}$/.test(val)) parsed.after = val;
      else freeTokens.push(`${key}:${val}`);
    } else if (plain) {
      freeTokens.push(plain);
    }
  }

  parsed.freeText = freeTokens.join(" ").trim();
  return parsed;
}

/**
 * Buduje obiekt kryteriów dla imapflow `client.search(criteria, { uid: true })`.
 * Gdy serwer Gmail wspiera `X-GM-EXT-1`, można dodatkowo wykorzystać `gmraw`.
 */
export function buildImapSearchCriteria(
  parsed: ParsedSearchQuery,
  supportsGmRaw = false
): Record<string, unknown> {
  if (supportsGmRaw && parsed.raw) {
    return { gmraw: parsed.raw };
  }

  const criteria: Record<string, unknown> = {};
  if (parsed.from) criteria.from = parsed.from;
  if (parsed.to) criteria.to = parsed.to;
  if (parsed.subject) criteria.subject = parsed.subject;
  if (parsed.isUnread) criteria.seen = false;
  if (parsed.isStarred) criteria.flagged = true;
  if (parsed.before) criteria.before = new Date(`${parsed.before}T23:59:59Z`);
  if (parsed.after) criteria.since = new Date(`${parsed.after}T00:00:00Z`);
  if (parsed.freeText) criteria.text = parsed.freeText;

  if (Object.keys(criteria).length === 0) {
    criteria.all = true;
  }
  return criteria;
}

// ============================================================================
// StorageQuotaView: normalizacja jednostek GETQUOTAROOT, sumowanie i deduplikacja
// ============================================================================

/**
 * Normalizuje wartości zwrócone z IMAP GETQUOTAROOT:
 * - imapflow mnoży już wartości RFC 2087 (KB) przez 1024 i zapisuje je w `storage.usage` / `storage.limit`.
 * - Część serwerów raportuje jednak limit/użycie już w bajtach (lub imapflow dostaje wartość 1024× zawyżoną — np. 5120 GB zamiast 5 GB).
 * - Funkcja wykrywa także historyczne pole `used` oraz automatycznie koryguje 1024-krotne zawyżenie.
 */
export function normalizeQuotaValues(params: {
  rawUsage?: number | null;
  rawLimit?: number | null;
  calculatedBytes: number;
  isGmail?: boolean;
}): { usedBytes: number; limitBytes: number | null } {
  let used =
    typeof params.rawUsage === "number" && Number.isFinite(params.rawUsage) && params.rawUsage >= 0
      ? params.rawUsage
      : 0;
  let limit =
    typeof params.rawLimit === "number" && Number.isFinite(params.rawLimit) && params.rawLimit > 0
      ? params.rawLimit
      : null;

  const ONE_TB = 1024 * 1024 * 1024 * 1024;
  const ONE_GB = 1024 * 1024 * 1024;

  // Wykrycie typowego błędu podwójnego mnożenia * 1024 (np. 5 GB -> 5120 GB = 5 TB przy faktycznej skrzynce < 20 GB)
  if (limit !== null) {
    const looksOverMultipliedByCalculated =
      params.calculatedBytes > 0 &&
      used > params.calculatedBytes * 256 &&
      used / 1024 <= Math.max(params.calculatedBytes * 4, ONE_GB);

    const looksOverMultipliedLimit =
      !params.isGmail &&
      limit >= 5 * ONE_TB &&
      used > 0 &&
      params.calculatedBytes > 0 &&
      used / 1024 >= params.calculatedBytes * 0.25 &&
      used / 1024 <= params.calculatedBytes * 4;

    if (looksOverMultipliedByCalculated || looksOverMultipliedLimit) {
      used = Math.round(used / 1024);
      limit = Math.round(limit / 1024);
    } else if (
      params.isGmail &&
      limit >= 5 * ONE_TB &&
      used > 0 &&
      used / 1024 < limit / 1024 &&
      params.calculatedBytes > 0 &&
      used > params.calculatedBytes * 128
    ) {
      used = Math.round(used / 1024);
      limit = Math.round(limit / 1024);
    }
  }

  return { usedBytes: used, limitBytes: limit };
}

export interface QuotaFolderCalcInput {
  path: string;
  specialUse?: string;
  messages: number;
  unseen: number;
  totalBytes: number;
  largestMessageBytes: number;
}

/**
 * Oblicza łączną liczbę wiadomości i bajtów z poprawną obsługą folderów zbiorczych (`[Gmail]/Wszystkie`):
 * - Jeśli istnieje folder zbiorczy `\All` (Gmail), traktujemy go jako bazę wszystkich maili
 *   (doliczając jedynie Kosz i Spam, które nie wchodzą do All Mail) — koniec z sumą 222 przy 17 205 mailach!
 * - W przeciwnym razie sumuje wszystkie foldery.
 */
export function calculateMailboxTotals(folders: QuotaFolderCalcInput[]): {
  totalMessages: number;
  totalCalculatedBytes: number;
  aggregateFolderPath: string | null;
} {
  const allMailFolder = folders.find(
    (f) => detectFolderRole(f.path, f.specialUse) === "all"
  );

  if (allMailFolder) {
    let totalMessages = allMailFolder.messages;
    let totalCalculatedBytes = allMailFolder.totalBytes;

    for (const f of folders) {
      const role = detectFolderRole(f.path, f.specialUse);
      if (role === "trash" || role === "spam") {
        totalMessages += f.messages;
        totalCalculatedBytes += f.totalBytes;
      }
    }

    return {
      totalMessages,
      totalCalculatedBytes,
      aggregateFolderPath: allMailFolder.path,
    };
  }

  let totalMessages = 0;
  let totalCalculatedBytes = 0;
  for (const f of folders) {
    totalMessages += f.messages;
    totalCalculatedBytes += f.totalBytes;
  }

  return {
    totalMessages,
    totalCalculatedBytes,
    aggregateFolderPath: null,
  };
}

export interface LargeMessageCandidate {
  uid: number;
  folder: string;
  messageId?: string;
  date: string;
  from: string;
  subject: string;
  sizeBytes: number;
  alsoInFolders?: string[];
}

/**
 * Deduplikuje listę największych wiadomości po `Message-ID` (lub parze temat+data+rozmiar),
 * preferując konkretny folder użytkownika zamiast zbiorczego `[Gmail]/Wszystkie`.
 */
export function deduplicateLargestMessages(
  candidates: LargeMessageCandidate[],
  limit = 50
): LargeMessageCandidate[] {
  const map = new Map<string, LargeMessageCandidate>();

  for (const item of candidates) {
    const normMsgId = (item.messageId || "").trim().toLowerCase().replace(/^<|>$/g, "");
    const fallbackKey = `${item.subject.trim().toLowerCase()}|${item.date}|${item.sizeBytes}`;
    const key = normMsgId ? `mid:${normMsgId}` : `fb:${fallbackKey}`;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...item, alsoInFolders: [] });
      continue;
    }

    const existingIsAll = detectFolderRole(existing.folder) === "all";
    const incomingIsAll = detectFolderRole(item.folder) === "all";

    if (existingIsAll && !incomingIsAll) {
      // Zamień główny folder ze zbiorczego na konkretny (np. [Gmail]/Wysłane)
      const extras = new Set(existing.alsoInFolders || []);
      extras.add(existing.folder);
      extras.delete(item.folder);
      map.set(key, {
        ...item,
        sizeBytes: Math.max(existing.sizeBytes, item.sizeBytes),
        alsoInFolders: Array.from(extras),
      });
    } else if (item.folder !== existing.folder) {
      const extras = new Set(existing.alsoInFolders || []);
      extras.add(item.folder);
      existing.alsoInFolders = Array.from(extras);
      if (item.sizeBytes > existing.sizeBytes) {
        existing.sizeBytes = item.sizeBytes;
      }
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, limit);
}

// ============================================================================
// Reguły klienckie dla przychodzących maili
// ============================================================================

export interface MailRuleCondition {
  field: "from" | "subject" | "domain" | "hasAttachment";
  contains?: string;
  hasAttachment?: boolean;
}

export interface MailRuleAction {
  star?: boolean;
  markRead?: boolean;
  moveToFolder?: string;
  suggestProjectCode?: string;
}

export interface ClientMailRule {
  id: string;
  name: string;
  enabled: boolean;
  matchAll: boolean;
  conditions: MailRuleCondition[];
  actions: MailRuleAction;
}

export function evaluateMailRules(
  rules: ClientMailRule[],
  msg: {
    fromEmail: string;
    fromName: string;
    subject: string;
    hasAttachments: boolean;
  }
): { matchedRules: ClientMailRule[]; mergedActions: MailRuleAction } {
  const fromLower = `${msg.fromName} ${msg.fromEmail}`.toLowerCase();
  const domain = (msg.fromEmail.split("@")[1] || "").toLowerCase();
  const subjectLower = msg.subject.toLowerCase();

  const matchedRules: ClientMailRule[] = [];
  const mergedActions: MailRuleAction = {};

  for (const rule of rules) {
    if (!rule.enabled || !rule.conditions.length) continue;

    const testCond = (c: MailRuleCondition): boolean => {
      const needle = (c.contains || "").trim().toLowerCase();
      if (c.field === "hasAttachment") {
        return msg.hasAttachments === (c.hasAttachment ?? true);
      }
      if (!needle) return false;
      if (c.field === "from") return fromLower.includes(needle);
      if (c.field === "domain") return domain === needle || domain.endsWith(`.${needle}`);
      if (c.field === "subject") return subjectLower.includes(needle);
      return false;
    };

    const isMatch = rule.matchAll
      ? rule.conditions.every(testCond)
      : rule.conditions.some(testCond);

    if (isMatch) {
      matchedRules.push(rule);
      if (rule.actions.star) mergedActions.star = true;
      if (rule.actions.markRead) mergedActions.markRead = true;
      if (rule.actions.moveToFolder && !mergedActions.moveToFolder) {
        mergedActions.moveToFolder = rule.actions.moveToFolder;
      }
      if (rule.actions.suggestProjectCode && !mergedActions.suggestProjectCode) {
        mergedActions.suggestProjectCode = rule.actions.suggestProjectCode;
      }
    }
  }

  return { matchedRules, mergedActions };
}
