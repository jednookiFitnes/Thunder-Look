import { Notice, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, TrinitecPluginSettings } from "./types";
import { MruStore } from "./utils/mruStore";
import { SecretService } from "./services/secretService";
import { MailCacheService } from "./services/mailCacheService";
import { ImapService } from "./services/imapService";
import { SmtpService } from "./services/smtpService";
import { ProjectMatcherService } from "./services/projectMatcherService";
import { VaultWriterService } from "./services/vaultWriterService";
import { ProjectLifecycleService } from "./services/projectLifecycleService";
import { AiBridgeService } from "./services/aiBridgeService";
import { parseRawEmlBuffer } from "./services/mailParserService";
import { TrinitecMailCodeBlockChild } from "./services/codeBlockProcessor";
import { SaveEmailModal } from "./modals/SaveEmailModal";
import { ComposeMailModal } from "./modals/ComposeMailModal";
import { NewProjectModal } from "./modals/NewProjectModal";
import { ArchiveProjectModal } from "./modals/ArchiveProjectModal";
import { MailWorkspaceView, VIEW_TYPE_TRINITEC_MAIL } from "./views/MailWorkspaceView";
import { StorageQuotaView, VIEW_TYPE_TRINITEC_STORAGE } from "./views/StorageQuotaView";
import { EmlViewerView, VIEW_TYPE_TRINITEC_EML } from "./views/EmlViewerView";
import { TrinitecSettingTab } from "./settings";

export default class TrinitecMailPlugin extends Plugin {
  settings: TrinitecPluginSettings = DEFAULT_SETTINGS;
  mruStore!: MruStore;
  secretService!: SecretService;
  cacheService!: MailCacheService;
  imapService!: ImapService;
  smtpService!: SmtpService;
  projectMatcher!: ProjectMatcherService;
  vaultWriter!: VaultWriterService;
  projectLifecycle!: ProjectLifecycleService;
  aiBridge!: AiBridgeService;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.mruStore = new MruStore(this.app);
    this.secretService = new SecretService(this.app);
    this.cacheService = new MailCacheService();
    this.imapService = new ImapService(this.settings, this.secretService, this.cacheService);
    this.smtpService = new SmtpService(this.settings, this.secretService, this.imapService);
    this.projectMatcher = new ProjectMatcherService(this.app, this.settings, this.mruStore);
    this.vaultWriter = new VaultWriterService(this.app, this.settings, this.mruStore);
    this.projectLifecycle = new ProjectLifecycleService(this.app, this.settings);
    this.aiBridge = new AiBridgeService(this.app, this.settings);

    // Rejestracja widoków i rozszerzenia .eml
    this.registerView(VIEW_TYPE_TRINITEC_MAIL, (leaf) => new MailWorkspaceView(leaf, this));
    this.registerView(VIEW_TYPE_TRINITEC_STORAGE, (leaf) => new StorageQuotaView(leaf, this));
    this.registerView(VIEW_TYPE_TRINITEC_EML, (leaf) => new EmlViewerView(leaf, this));
    this.registerExtensions(["eml"], VIEW_TYPE_TRINITEC_EML);

    // Odporny procesor bloku kodu ```trinitec-mail```
    this.registerMarkdownCodeBlockProcessor("trinitec-mail", (source, el, ctx) => {
      ctx.addChild(new TrinitecMailCodeBlockChild(el, this.app, source, ctx));
    });

    // Ikony w pasku bocznym (Ribbon)
    this.addRibbonIcon("mail", "Trinitec: Otwórz klienta IMAP", () => {
      void this.activateMailView();
    });

    this.addRibbonIcon("hard-drive", "Trinitec: Podgląd rozmiaru skrzynki IMAP", () => {
      void this.activateStorageView();
    });

    // Komendy palety poleceń
    this.addCommand({
      id: "trinitec-open-mail-view",
      name: "Trinitec: Otwórz skrzynkę IMAP",
      callback: () => void this.activateMailView(),
    });

    this.addCommand({
      id: "trinitec-open-storage-view",
      name: "Trinitec: Podgląd rozmiaru skrzynki i folderów",
      callback: () => void this.activateStorageView(),
    });

    this.addCommand({
      id: "trinitec-compose-email",
      name: "Trinitec: Wyślij nowy e-mail (SMTP)",
      callback: () => {
        new ComposeMailModal(
          this.app,
          this.smtpService,
          this.projectMatcher,
          this.mruStore
        ).open();
      },
    });

    this.addCommand({
      id: "trinitec-parse-clipboard",
      name: "Trinitec: Parse email from clipboard",
      callback: async () => {
        const raw = await navigator.clipboard.readText();
        if (!raw.trim()) {
          new Notice("Schowek jest pusty.");
          return;
        }
        const parsed = await parseRawEmlBuffer(raw);
        const proposal = this.aiBridge.analyzeContent(parsed.subject, parsed.strippedMarkdownBody);
        new SaveEmailModal(
          this.app,
          this.settings,
          this.projectMatcher,
          this.vaultWriter,
          this.mruStore,
          parsed,
          "",
          proposal
        ).open();
      },
    });

    this.addCommand({
      id: "trinitec-create-project",
      name: "Trinitec: Create new project",
      callback: () => new NewProjectModal(this.app, this.projectLifecycle).open(),
    });

    this.addCommand({
      id: "trinitec-archive-project",
      name: "Trinitec: Archive active project",
      callback: () => {
        const projects = this.projectMatcher.listActiveProjects(true);
        new ArchiveProjectModal(this.app, projects, async (proj) => {
          await this.projectLifecycle.archiveProject(proj);
        }).open();
      },
    });

    this.addCommand({
      id: "trinitec-ai-analyze-active-note",
      name: "Trinitec: Analizuj aktywną notatkę (AI: kategoria, priorytet, zadania)",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile)) {
          new Notice("Otwórz najpierw notatkę Markdown.");
          return;
        }
        const content = await this.app.vault.read(file);
        const proposal = this.aiBridge.analyzeContent(file.basename, content);
        await this.aiBridge.applyAnalysisToMarkdownNote(file, proposal);
      },
    });

    // Obsługa przeciągania plików .eml bezpośrednio do Obsidiana (Opt-in SaveModal)
    this.registerDomEvent(window, "drop", async (evt: DragEvent) => {
      const files = evt.dataTransfer?.files;
      if (!files || files.length === 0) return;
      const emlFile = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".eml"));
      if (!emlFile) return;

      evt.preventDefault();
      const buffer = Buffer.from(await emlFile.arrayBuffer());
      const parsed = await parseRawEmlBuffer(buffer);
      const proposal = this.aiBridge.analyzeContent(parsed.subject, parsed.strippedMarkdownBody);
      new SaveEmailModal(
        this.app,
        this.settings,
        this.projectMatcher,
        this.vaultWriter,
        this.mruStore,
        parsed,
        "",
        proposal
      ).open();
    });

    this.addSettingTab(new TrinitecSettingTab(this.app, this));

    // Opcjonalne uruchomienie IMAP IDLE w tle (po pełnym załadowaniu layoutu)
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enableImapIdle && this.settings.imapHost && this.settings.imapUser) {
        void this.imapService.startIdleWatcher((folder) => {
          new Notice(`Nowa wiadomość w folderze ${folder}`);
          const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TRINITEC_MAIL);
          for (const leaf of leaves) {
            if (leaf.view instanceof MailWorkspaceView) {
              void leaf.view.refreshFolder(folder);
            }
          }
        });
      }
    });
  }

  /**
   * Zgodnie z AGENTS.md:
   * NIGDY nie wywołuj detachLeavesOfType() w onunload() — chroni to układ okien użytkownika.
   * Zamykamy wyłącznie globalne połączenie IMAP IDLE oraz lokalny uchwyt IndexedDB.
   */
  onunload(): void {
    void this.imapService?.stopIdleWatcher();
    this.cacheService?.close();
  }

  async activateMailView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TRINITEC_MAIL)[0];
    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TRINITEC_MAIL, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async activateStorageView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TRINITEC_STORAGE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TRINITEC_STORAGE, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<TrinitecPluginSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded || {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.imapService?.updateSettings(this.settings);
    this.smtpService?.updateSettings(this.settings);
    this.projectMatcher?.updateSettings(this.settings);
    this.vaultWriter?.updateSettings(this.settings);
    this.projectLifecycle?.updateSettings(this.settings);
    this.aiBridge?.updateSettings(this.settings);
  }
}
