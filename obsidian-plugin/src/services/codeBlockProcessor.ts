import { App, MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from "obsidian";
import { naturalCompare } from "../utils/textUtils";
import { EditCodeBlockModal } from "../modals/EditCodeBlockModal";

export interface MailCodeBlockConfig {
  project?: string;
  limit?: number;
  topic?: string;
}

/**
 * Procesor bloku kodu ```trinitec-mail``` oparty na MarkdownRenderChild.
 * Zgodnie z AGENTS.md (Code Block Processor Error Resilience):
 * błąd parsowania parametrów NIGDY nie ukrywa paska akcji z przyciskiem edycji bloku w modalu.
 */
export class TrinitecMailCodeBlockChild extends MarkdownRenderChild {
  private app: App;
  private source: string;
  private ctx: MarkdownPostProcessorContext;

  constructor(
    containerEl: HTMLElement,
    app: App,
    source: string,
    ctx: MarkdownPostProcessorContext
  ) {
    super(containerEl);
    this.app = app;
    this.source = source;
    this.ctx = ctx;
  }

  onload(): void {
    this.render();
  }

  private render(): void {
    this.containerEl.empty();
    const wrapper = this.containerEl.createDiv({ cls: "trinitec-mail-codeblock" });

    // Pasek akcji zawsze widoczny (nawet w razie błędu parsowania konfiguracji bloku)
    const header = wrapper.createDiv({ cls: "trinitec-mail-codeblock-header" });
    header.createEl("strong", { text: "Trinitec Mail — Korespondencja projektu" });

    const editBtn = header.createEl("button", { text: "Edytuj blok" });
    editBtn.onclick = () => {
      const section = this.ctx.getSectionInfo(this.containerEl);
      const sourceFile = this.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
      if (!(sourceFile instanceof TFile) || !section) return;
      new EditCodeBlockModal(
        this.app,
        sourceFile,
        section.lineStart,
        section.lineEnd,
        this.source
      ).open();
    };

    // Parsowanie parametrów klucz: wartość
    let parsed: MailCodeBlockConfig;
    try {
      parsed = this.parseConfig(this.source);
    } catch (err) {
      wrapper.createDiv({
        cls: "trinitec-mail-codeblock-error",
        text: `Błąd konfiguracji bloku: ${(err as Error).message}. Kliknij „Edytuj blok”, aby poprawić parametry.`,
      });
      return;
    }

    const projectFilter = (parsed.project || "").trim().toLowerCase();
    const topicFilter = (parsed.topic || "Korespondencja").trim().toLowerCase();
    const limit = parsed.limit && parsed.limit > 0 ? parsed.limit : 15;

    const matchingFiles: Array<{ file: TFile; date: string; from: string; subject: string }> = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      const topics: string[] = Array.isArray(fm.electrical_topic)
        ? fm.electrical_topic.map((t: unknown) => String(t).toLowerCase())
        : typeof fm.electrical_topic === "string"
        ? [fm.electrical_topic.toLowerCase()]
        : [];

      if (topicFilter && !topics.includes(topicFilter)) continue;

      if (projectFilter) {
        const indexText = JSON.stringify(fm.index || "").toLowerCase();
        const pathMatch = file.path.toLowerCase().includes(projectFilter);
        if (!indexText.includes(projectFilter) && !pathMatch) continue;
      }

      matchingFiles.push({
        file,
        date: String(fm.date || ""),
        from: String(fm.from || ""),
        subject: String(fm.subject || file.basename),
      });
    }

    matchingFiles.sort(
      (a, b) => naturalCompare(b.date, a.date) || naturalCompare(a.subject, b.subject)
    );

    const visible = matchingFiles.slice(0, limit);
    if (visible.length === 0) {
      wrapper.createDiv({
        cls: "trinitec-mail-status-text",
        text: "Brak zapisanych wiadomości spełniających filtry tego bloku.",
      });
      return;
    }

    const table = wrapper.createEl("table", { cls: "trinitec-mail-table" });
    const head = table.createTHead().insertRow();
    head.createEl("th", { text: "Data" });
    head.createEl("th", { text: "Temat" });
    head.createEl("th", { text: "Nadawca" });

    const body = table.createTBody();
    for (const row of visible) {
      const tr = body.insertRow();
      tr.createEl("td", { text: row.date });
      const tdSubj = tr.createEl("td");
      const link = tdSubj.createEl("a", { text: row.subject, href: "#" });
      link.onclick = async (e) => {
        e.preventDefault();
        await this.app.workspace.getLeaf(false).openFile(row.file);
      };
      tr.createEl("td", { text: row.from });
    }
  }

  private parseConfig(raw: string): MailCodeBlockConfig {
    const cfg: MailCodeBlockConfig = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf(":");
      if (idx === -1) {
        throw new Error(`Niepoprawny wiersz „${trimmed}” (oczekiwano formatu klucz: wartość)`);
      }
      const key = trimmed.slice(0, idx).trim().toLowerCase();
      const val = trimmed.slice(idx + 1).trim();
      if (key === "project") cfg.project = val;
      else if (key === "topic") cfg.topic = val;
      else if (key === "limit") {
        const n = Number(val);
        if (!Number.isFinite(n) || n < 1) {
          throw new Error(`Pole „limit” musi być dodatnią liczbą (otrzymano: ${val})`);
        }
        cfg.limit = Math.floor(n);
      } else {
        throw new Error(`Nieznany parametr „${key}” (dozwolone: project, topic, limit)`);
      }
    }
    return cfg;
  }
}
