import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { MailboxQuotaReport } from "../types";
import { formatBytes, naturalCompare } from "../utils/textUtils";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import type TrinitecMailPlugin from "../main";

export const VIEW_TYPE_TRINITEC_STORAGE = "trinitec-mail-storage";

type SortColumn = "size" | "date" | "folder";

export class StorageQuotaView extends ItemView {
  private plugin: TrinitecMailPlugin;
  private report: MailboxQuotaReport | null = null;
  private loading = false;
  private isClosed = false;
  private sortBy: SortColumn = "size";
  private sortDesc = true;
  private folderFilter = "ALL";

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TRINITEC_STORAGE;
  }

  getDisplayText(): string {
    return "Thunder Look — Rozmiar skrzynki";
  }

  getIcon(): string {
    return "hard-drive";
  }

  async onOpen(): Promise<void> {
    this.isClosed = false;
    this.render();
  }

  async onClose(): Promise<void> {
    this.isClosed = true;
    this.report = null;
    this.contentEl.empty();
  }

  async scanStorage(): Promise<void> {
    if (this.isClosed || this.loading) return;
    this.loading = true;
    this.render();
    try {
      const rep = await this.plugin.imapService.getMailboxStorageReport(50);
      if (this.isClosed) return;
      this.report = rep;
    } catch (err) {
      if (!this.isClosed) {
        new Notice(`Błąd odczytu rozmiaru skrzynki IMAP: ${(err as Error).message}`);
      }
    } finally {
      if (!this.isClosed) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    const root = container.createDiv({ cls: "tl-quota-panel" });

    const topbar = root.createDiv({ cls: "tl-topbar" });
    topbar.createEl("h3", { text: "Podgląd zajętości skrzynki IMAP (Thunder Look)" });
    const scanBtn = topbar.createEl("button", {
      text: this.loading ? "Skanowanie folderów..." : "Skanuj skrzynkę",
      type: "button",
      cls: "mod-cta",
    });
    scanBtn.disabled = this.loading;
    scanBtn.addEventListener("click", () => {
      void this.scanStorage();
    });

    if (!this.report) {
      root.createDiv({
        cls: "tl-status-text",
        text: "Kliknij „Skanuj skrzynkę”, aby odpytać serwer IMAP (GETQUOTAROOT, LIST, STATUS oraz RFC822.SIZE) bez zmieniania flag nieprzeczytanych wiadomości.",
      });
      return;
    }

    const r = this.report;
    const pct = r.usagePercent ?? 0;

    const summary = root.createDiv();
    summary.createEl("p", {
      text: r.limitBytes
        ? `Zajętość: ${formatBytes(r.usedBytes)} / ${formatBytes(r.limitBytes)} (${pct}%) · Łącznie wiadomości: ${r.totalMessages}`
        : `Obliczony rozmiar wiadomości: ${formatBytes(r.totalCalculatedBytes)} · Łącznie wiadomości: ${r.totalMessages} (serwer nie raportuje limitu QUOTA)`,
    });

    if (r.limitBytes) {
      const bar = summary.createDiv({ cls: "tl-quota-bar" });
      const fill = bar.createDiv({
        cls: `tl-quota-fill${
          pct >= 90
            ? " is-danger"
            : pct >= this.plugin.settings.quotaWarnPercent
            ? " is-warn"
            : ""
        }`,
      });
      fill.style.width = `${Math.min(100, pct)}%`;
    }

    root.createEl("h4", { text: "Rozmiar według folderów (kliknij folder, aby przefiltrować)" });
    const fTable = root.createEl("table", { cls: "tl-table" });
    const fHead = fTable.createTHead().insertRow();
    fHead.createEl("th", { text: "Folder IMAP" });
    fHead.createEl("th", { text: "Wiadomości", cls: "is-num" });
    fHead.createEl("th", { text: "Nieprzeczytane", cls: "is-num" });
    fHead.createEl("th", { text: "Rozmiar", cls: "is-num" });
    fHead.createEl("th", { text: "Max wiadomość", cls: "is-num" });

    const fBody = fTable.createTBody();
    for (const f of r.folders) {
      const tr = fBody.insertRow();
      tr.addClass("tl-clickable-row");
      tr.addEventListener("click", () => {
        this.folderFilter = this.folderFilter === f.path ? "ALL" : f.path;
        this.render();
      });
      tr.createEl("td", {
        text: this.folderFilter === f.path ? `▸ ${f.path}` : f.path,
      });
      tr.createEl("td", { text: String(f.messages), cls: "is-num" });
      tr.createEl("td", { text: String(f.unseen), cls: "is-num" });
      tr.createEl("td", { text: formatBytes(f.totalBytes), cls: "is-num" });
      tr.createEl("td", { text: formatBytes(f.largestMessageBytes), cls: "is-num" });
    }

    const msgHeaderRow = root.createDiv({ cls: "tl-actions-row" });
    msgHeaderRow.createEl("h4", {
      text: "Największe wiadomości (kliknij nagłówek kolumny, aby sortować)",
    });
    if (this.folderFilter !== "ALL") {
      const clearBtn = msgHeaderRow.createEl("button", {
        text: `Wyczyść filtr (${this.folderFilter})`,
        type: "button",
      });
      clearBtn.addEventListener("click", () => {
        this.folderFilter = "ALL";
        this.render();
      });
    }

    const mTable = root.createEl("table", { cls: "tl-table" });
    const mHead = mTable.createTHead().insertRow();

    const addSortTh = (label: string, col: SortColumn, isNum = false) => {
      const th = mHead.createEl("th", {
        text: `${label}${this.sortBy === col ? (this.sortDesc ? " ↓" : " ↑") : ""}`,
        cls: isNum ? "is-num" : "",
      });
      th.addEventListener("click", () => {
        if (this.sortBy === col) this.sortDesc = !this.sortDesc;
        else {
          this.sortBy = col;
          this.sortDesc = true;
        }
        this.render();
      });
    };

    addSortTh("Folder", "folder");
    addSortTh("Data", "date");
    mHead.createEl("th", { text: "Temat / Nadawca" });
    addSortTh("Rozmiar", "size", true);
    mHead.createEl("th", { text: "Akcja" });

    const filtered =
      this.folderFilter === "ALL"
        ? r.largestMessages
        : r.largestMessages.filter((m) => m.folder === this.folderFilter);

    const sorted = [...filtered].sort((a, b) => {
      const dir = this.sortDesc ? -1 : 1;
      if (this.sortBy === "size") return (a.sizeBytes - b.sizeBytes) * dir;
      if (this.sortBy === "date") return naturalCompare(a.date, b.date) * dir;
      return naturalCompare(a.folder, b.folder) * dir;
    });

    const mBody = mTable.createTBody();
    for (const msg of sorted) {
      const tr = mBody.insertRow();
      tr.createEl("td", { text: msg.folder });
      tr.createEl("td", { text: msg.date });
      tr.createEl("td", { text: `${msg.subject} (${msg.from})` });
      tr.createEl("td", { text: formatBytes(msg.sizeBytes), cls: "is-num" });
      const actionTd = tr.createEl("td");
      const saveBtn = actionTd.createEl("button", {
        text: "Zapisz / Załączniki",
        type: "button",
      });
      saveBtn.addEventListener("click", async () => {
        try {
          const full = await this.plugin.imapService.fetchFullMessage(msg.folder, msg.uid);
          const proposal = this.plugin.aiBridge.analyzeContent(
            full.subject,
            full.strippedMarkdownBody
          );
          new SaveEmailModal(
            this.app,
            this.plugin.settings,
            this.plugin.projectMatcher,
            this.plugin.vaultWriter,
            this.plugin.mruStore,
            full,
            "",
            proposal
          ).open();
        } catch (err) {
          new Notice(`Nie udało się pobrać wiadomości: ${(err as Error).message}`);
        }
      });
    }
  }
}
