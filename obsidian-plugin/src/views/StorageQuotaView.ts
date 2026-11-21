import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { MailboxQuotaReport } from "../types";
import { formatBytes, naturalCompare } from "../utils/textUtils";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import type TrinitecMailPlugin from "../main";

export const VIEW_TYPE_TRINITEC_STORAGE = "trinitec-mail-storage";

type SortColumn = "size" | "date" | "folder";

export class StorageQuotaView extends ItemView {
  private plugin: TrinitecMailPlugin;
  private selectedAccountId: string;
  private report: MailboxQuotaReport | null = null;
  private loading = false;
  private isClosed = false;
  private sortBy: SortColumn = "size";
  private sortDesc = true;
  private folderFilter = "ALL";

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedAccountId =
      plugin.settings.activeAccountId || plugin.settings.accounts[0]?.id || "default";
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
      const rep = await this.plugin.imapService.getMailboxStorageReport(
        50,
        this.selectedAccountId
      );
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
    topbar.createEl("h3", { text: "Monitor zajętości skrzynki IMAP (Thunder Look)" });

    const controls = topbar.createDiv({ cls: "tl-topbar-group" });
    const enabledAccounts = this.plugin.settings.accounts.filter((a) => a.enabled);
    if (enabledAccounts.length > 1) {
      const accSelect = controls.createEl("select", { cls: "dropdown" });
      for (const acc of enabledAccounts) {
        const opt = accSelect.createEl("option", {
          value: acc.id,
          text: `${acc.label} (${acc.imapUser || acc.imapHost})`,
        });
        if (acc.id === this.selectedAccountId) opt.selected = true;
      }
      accSelect.addEventListener("change", () => {
        this.selectedAccountId = accSelect.value;
        this.report = null;
        this.folderFilter = "ALL";
        this.render();
      });
    }

    const scanBtn = controls.createEl("button", {
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
        cls: "tl-empty-state",
        text: "Kliknij „Skanuj skrzynkę”, aby odpytać serwer IMAP (GETQUOTAROOT, LIST, STATUS oraz RFC822.SIZE) bez zmieniania flag nieprzeczytanych wiadomości.",
      });
      return;
    }

    const r = this.report;
    const pct = r.usagePercent ?? 0;

    const summary = root.createDiv({ cls: "tl-quota-summary-card" });
    summary.createEl("p", {
      cls: "tl-quota-summary-main",
      text: r.limitBytes
        ? `Zajętość: ${formatBytes(r.usedBytes)} / ${formatBytes(r.limitBytes)} (${pct}%) · Łącznie wiadomości: ${r.totalMessages.toLocaleString("pl-PL")}`
        : `Obliczony rozmiar wiadomości: ${formatBytes(r.totalCalculatedBytes)} · Łącznie wiadomości: ${r.totalMessages.toLocaleString("pl-PL")} (serwer nie raportuje limitu QUOTA)`,
    });

    if (r.aggregateFolderPath) {
      summary.createDiv({
        cls: "tl-muted-xs",
        text: `Folder zbiorczy „${r.aggregateFolderPath}” został użyty jako podstawa sumy (plus Kosz/Spam), aby uniknąć podwójnego zliczania etykiet.`,
      });
    }

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
      const nameTd = tr.createEl("td");
      nameTd.createSpan({
        text: this.folderFilter === f.path ? `▸ ${f.path}` : f.path,
      });
      if (f.isAggregate) {
        nameTd.createSpan({
          cls: "tl-aggregate-badge",
          text: "zbiorczy",
          attr: { title: "Folder zbiorczy zawierający wszystkie etykiety Gmaila" },
        });
      }
      tr.createEl("td", { text: f.messages.toLocaleString("pl-PL"), cls: "is-num" });
      tr.createEl("td", { text: f.unseen.toLocaleString("pl-PL"), cls: "is-num" });
      tr.createEl("td", { text: formatBytes(f.totalBytes), cls: "is-num" });
      tr.createEl("td", { text: formatBytes(f.largestMessageBytes), cls: "is-num" });
    }

    const msgHeaderRow = root.createDiv({ cls: "tl-actions-row" });
    msgHeaderRow.createEl("h4", {
      text: `Największe unikalne wiadomości (${r.largestMessages.length}) — kliknij nagłówek kolumny, aby sortować`,
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
        : r.largestMessages.filter(
            (m) =>
              m.folder === this.folderFilter ||
              (m.alsoInFolders || []).includes(this.folderFilter)
          );

    const sorted = [...filtered].sort((a, b) => {
      const dir = this.sortDesc ? -1 : 1;
      if (this.sortBy === "size") return (a.sizeBytes - b.sizeBytes) * dir;
      if (this.sortBy === "date") return naturalCompare(a.date, b.date) * dir;
      return naturalCompare(a.folder, b.folder) * dir;
    });

    const mBody = mTable.createTBody();
    for (const msg of sorted) {
      const tr = mBody.insertRow();
      const folderTd = tr.createEl("td");
      folderTd.createSpan({ text: msg.folder });
      if (msg.alsoInFolders && msg.alsoInFolders.length > 0) {
        folderTd.createSpan({
          cls: "tl-muted-xs",
          text: ` (+${msg.alsoInFolders.length})`,
          attr: { title: `Również w: ${msg.alsoInFolders.join(", ")}` },
        });
      }
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
          const full = await this.plugin.imapService.fetchFullMessage(msg.folder, msg.uid, {
            accountId: this.selectedAccountId,
          });
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
