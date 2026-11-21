import { Notice, Plugin, TFile } from "obsidian";
import {
  DEFAULT_SETTINGS,
  PluginRuntimeStatus,
  TrinitecPluginSettings,
} from "./types";
import { MruStore } from "./utils/mruStore";
import { migrateAndValidateSettings } from "./utils/settingsMigration";
import { SecretService } from "./services/secretService";
import { GoogleOAuthService } from "./services/googleOAuthService";
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
  googleOAuthService!: GoogleOAuthService;
  cacheService!: MailCacheService;
  imapService!: ImapService;
  smtpService!: SmtpService;
  projectMatcher!: ProjectMatcherService;
  vaultWriter!: VaultWriterService;
  projectLifecycle!: ProjectLifecycleService;
  aiBridge!: AiBridgeService;

  runtimeStatus: PluginRuntimeStatus = {
    state: "idle",
    lastSyncAt: null,
    unreadCount: 0,
    lastError: null,
  };

  private statusBarItemEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.mruStore = new MruStore(this.app);
    this.secretService = new SecretService(this.app);
    this.googleOAuthService = new GoogleOAuthService(this.secretService);
    this.cacheService = new MailCacheService();
    this.imapService = new ImapService(
      this.settings,
      this.secretService,
      this.cacheService,
      this.googleOAuthService
    );
    this.smtpService = new SmtpService(
      this.settings,
      this.secretService,
      this.imapService,
      this.googleOAuthService
    );
    this.projectMatcher = new ProjectMatcherService(this.app, this.settings, this.mruStore);
    this.vaultWriter = new VaultWriterService(this.app, this.settings, this.mruStore);
    this.projectLifecycle = new ProjectLifecycleService(this.app, this.settings);
    this.aiBridge = new AiBridgeService(this.app, this.settings);

    // Rejestracja widoków i rozszerzenia .eml
    this.registerView(VIEW_TYPE_TRINITEC_MAIL, (leaf) => new MailWorkspaceView(leaf, this));
    this.registerView(VIEW_TYPE_TRINITEC_STORAGE, (leaf) => new StorageQuotaView(leaf, this));
    this.registerView(VIEW_TYPE_TRINITEC_EML, (leaf) => new EmlViewerView(leaf, this));
    this.registerExtensions(["eml"], VIEW_TYPE_TRINITEC_EML);

    // Procesor bloku kodu ```thunder-look``` oraz zachowana kompatybilność z ```trinitec-mail```
    const registerBlock = (lang: string) => {
      this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
        ctx.addChild(new TrinitecMailCodeBlockChild(el, this.app, source, ctx));
      });
    };
    registerBlock("thunder-look");
    registerBlock("trinitec-mail");

    // Pasek stanu (Status Bar) — stan połączenia, ostatnia synchronizacja, liczba nieprzeczytanych
    this.statusBarItemEl = this.addStatusBarItem();
    this.statusBarItemEl.addClass("tl-statusbar-item");
    this.registerDomEvent(this.statusBarItemEl, "click", () => {
      void this.activateMailView();
    });
    this.renderStatusBar();

    // Ikony w pasku bocznym (Ribbon)
    this.addRibbonIcon("mail", "Thunder Look: Otwórz klienta IMAP", () => {
      void this.activateMailView();
    });

    this.addRibbonIcon("hard-drive", "Thunder Look: Podgląd rozmiaru skrzynki IMAP", () => {
      void this.activateStorageView();
    });

    // Komendy palety poleceń
    this.addCommand({
      id: "thunder-look-open-mail-view",
      name: "Otwórz skrzynkę IMAP",
      callback: () => void this.activateMailView(),
    });

    this.addCommand({
      id: "thunder-look-open-storage-view",
      name: "Podgląd rozmiaru skrzynki i folderów",
      callback: () => void this.activateStorageView(),
    });

    this.addCommand({
      id: "thunder-look-compose-email",
      name: "Wyślij nowy e-mail (SMTP)",
      callback: () => {
        const signature = this.settings.emailSignature.trim()
          ? `\n\n-- \n${this.settings.emailSignature.trim()}`
          : "";
        new ComposeMailModal(
          this.app,
          this.settings,
          this.smtpService,
          this.projectMatcher,
          this.mruStore,
          { body: signature }
        ).open();
      },
    });

    this.addCommand({
      id: "thunder-look-parse-clipboard",
      name: "Wklej i zapisz e-mail ze schowka",
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
      id: "thunder-look-create-project",
      name: "Utwórz nowy projekt",
      callback: () => new NewProjectModal(this.app, this.projectLifecycle).open(),
    });

    this.addCommand({
      id: "thunder-look-archive-project",
      name: "Zarchiwizuj aktywny projekt",
      callback: () => {
        const projects = this.projectMatcher.listActiveProjects(true);
        new ArchiveProjectModal(this.app, projects, async (proj) => {
          await this.projectLifecycle.archiveProject(proj);
        }).open();
      },
    });

    this.addCommand({
      id: "thunder-look-ai-analyze-active-note",
      name: "Analizuj aktywną notatkę (AI: kategoria, priorytet, zadania)",
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
      try {
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
      } catch (err) {
        new Notice(`Nie udało się przetworzyć pliku .eml: ${(err as Error).message}`);
      }
    });

    this.addSettingTab(new TrinitecSettingTab(this.app, this));

    // Opcjonalne uruchomienie IMAP IDLE w tle (po pełnym załadowaniu layoutu)
    this.app.workspace.onLayoutReady(() => {
      if (this.settings.enableImapIdle && this.settings.imapHost && this.settings.imapUser) {
        void this.imapService.startIdleWatcher((folder) => {
          new Notice(`Thunder Look: nowa wiadomość w folderze ${folder}`);
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
   * Zgodnie z wytycznymi Obsidian Plugin Guidelines:
   * NIGDY nie wywołuj detachLeavesOfType() w onunload() — nie niszczymy układu okien użytkownika.
   */
  onunload(): void {
    void this.imapService?.stopIdleWatcher();
    this.cacheService?.close();
  }

  updateRuntimeStatus(partial: Partial<PluginRuntimeStatus>): void {
    this.runtimeStatus = { ...this.runtimeStatus, ...partial };
    this.renderStatusBar();
  }

  private renderStatusBar(): void {
    if (!this.statusBarItemEl) return;
    const { state, lastSyncAt, unreadCount, lastError } = this.runtimeStatus;
    const syncLabel = lastSyncAt ? lastSyncAt.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }) : "—";
    let stateLabel = "Gotowy";
    if (state === "syncing") stateLabel = "Synchronizacja...";
    else if (state === "connected") stateLabel = "Połączono";
    else if (state === "offline") stateLabel = "Offline (cache)";
    else if (state === "error") stateLabel = "Błąd IMAP";

    this.statusBarItemEl.setText(
      `Thunder Look: ${stateLabel} · Nieprzecz.: ${unreadCount} · Sync: ${syncLabel}`
    );
    this.statusBarItemEl.setAttr(
      "title",
      lastError
        ? `Thunder Look — ${lastError}. Kliknij, aby otworzyć pocztę.`
        : "Kliknij, aby otworzyć skrzynkę Thunder Look"
    );
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
    const rawLoaded = (await this.loadData()) as Record<string, unknown> | null;
    const prevVersion = rawLoaded && typeof rawLoaded === "object" ? rawLoaded.settingsVersion : 0;
    this.settings = migrateAndValidateSettings(rawLoaded);
    if (prevVersion !== this.settings.settingsVersion) {
      await this.saveData(this.settings);
    }
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
