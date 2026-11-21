import { Notice, setIcon } from "obsidian";
import { detectFolderRole } from "../../../../shared/folderMapper";
import { isDangerousAttachmentExtension } from "../../../../shared/pathSecurity";
import {
  AiAnalysisProposal,
  ImapMessageHeader,
  ParsedAttachment,
  ParsedEmailMessage,
  ReaderViewTheme,
} from "../../types";
import { filterRelatedThreadMessages } from "../../services/mailParserService";
import { sanitizeHtmlForSandbox } from "../../utils/htmlSanitizer";
import { extractCleanSnippet, formatBytes } from "../../utils/textUtils";
import { getDeterministicAvatar, formatRelativeDatePl } from "./ThreadListPane";
import type TrinitecMailPlugin from "../../main";

export type ReplyComposeMode = "reply" | "reply-all" | "forward";

function iconForAttachment(filename: string, contentType: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mime = (contentType || "").toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return "image";
  }
  if (mime === "application/pdf" || ext === "pdf") return "file-text";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "file-archive";
  if (["xls", "xlsx", "csv"].includes(ext)) return "file-spreadsheet";
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return "file-type";
  return "paperclip";
}

function isPreviewableAttachment(filename: string, contentType: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mime = (contentType || "").toLowerCase();
  return (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime.startsWith("text/") ||
    ["png", "jpg", "jpeg", "webp", "gif", "pdf", "txt", "md", "csv", "json", "xml", "log"].includes(
      ext
    )
  );
}

/**
 * Bezpiecznie czyści wszelkie poprzednie elementy <iframe> w kontenerze,
 * aby silnik Chromium/Electron nigdy nie zatrzymywał starego dokumentu po przełączeniu wiadomości.
 */
export function disposeReaderIframes(container: HTMLElement | null): void {
  if (!container) return;
  const frames = container.querySelectorAll("iframe");
  frames.forEach((frame) => {
    try {
      frame.srcdoc = "";
      frame.src = "about:blank";
    } catch {
      // ignore
    }
    frame.remove();
  });
}

export function renderMessageReaderPane(params: {
  pane: HTMLElement;
  plugin: TrinitecMailPlugin;
  selectedHeader: ImapMessageHeader | null;
  selectedEmail: ParsedEmailMessage | null;
  threadMessages: ImapMessageHeader[];
  expandedThreadEmails: Map<number, ParsedEmailMessage>;
  loadingMessage: boolean;
  themeMode: ReaderViewTheme;
  allowRemoteImages: boolean;
  showStrippedMarkdown: boolean;
  showDetails: boolean;
  aiBarCollapsed: boolean;
  offlineMode: boolean;
  onSaveOptIn: (email: ParsedEmailMessage, proposal: AiAnalysisProposal) => void;
  onComposeAction: (email: ParsedEmailMessage, mode: ReplyComposeMode) => void;
  onToggleSeen: (email: ParsedEmailMessage) => void;
  onToggleStar: (email: ParsedEmailMessage) => void;
  onDelete: (email: ParsedEmailMessage) => void;
  onRestoreFromTrash: (email: ParsedEmailMessage) => void;
  onArchive: (email: ParsedEmailMessage) => void;
  onToggleSpam: (email: ParsedEmailMessage, markAsSpam: boolean) => void;
  onMoveToFolder: (email: ParsedEmailMessage) => void;
  onApplyAiMove: (email: ParsedEmailMessage, proposal: AiAnalysisProposal) => void;
  onSetThemeMode: (mode: ReaderViewTheme) => void;
  onToggleStripped: () => void;
  onToggleDetails: () => void;
  onToggleAiBar: () => void;
  onAllowRemoteImagesOnce: () => void;
  onTrustRemoteImagesSender: (senderEmail: string) => void;
  onPreviewAttachment: (email: ParsedEmailMessage, att: ParsedAttachment) => void;
  onSaveAttachmentToVault: (email: ParsedEmailMessage, att: ParsedAttachment) => void;
  onDownloadAttachmentToDisk: (email: ParsedEmailMessage, att: ParsedAttachment) => void;
  onSaveAllAttachments: (email: ParsedEmailMessage) => void;
  onViewRawSource: (email: ParsedEmailMessage) => void;
  onExpandThreadMessage: (header: ImapMessageHeader) => void;
}): void {
  const {
    pane,
    plugin,
    selectedHeader,
    selectedEmail,
    threadMessages,
    expandedThreadEmails,
    loadingMessage,
    themeMode,
    allowRemoteImages,
    showStrippedMarkdown,
    showDetails,
    aiBarCollapsed,
    offlineMode,
    onSaveOptIn,
    onComposeAction,
    onToggleSeen,
    onToggleStar,
    onDelete,
    onRestoreFromTrash,
    onArchive,
    onToggleSpam,
    onMoveToFolder,
    onApplyAiMove,
    onSetThemeMode,
    onToggleStripped,
    onToggleDetails,
    onToggleAiBar,
    onAllowRemoteImagesOnce,
    onTrustRemoteImagesSender,
    onPreviewAttachment,
    onSaveAttachmentToVault,
    onDownloadAttachmentToDisk,
    onSaveAllAttachments,
    onViewRawSource,
    onExpandThreadMessage,
  } = params;

  // ZAWSZE najpierw fizycznie usuń stare <iframe> zanim wyrenderujesz nowy stan
  disposeReaderIframes(pane);
  pane.empty();

  if (!selectedEmail && !loadingMessage && !selectedHeader) {
    const empty = pane.createDiv({ cls: "tl-reader-empty" });
    const icon = empty.createDiv({ cls: "tl-reader-empty-icon" });
    setIcon(icon, "mail-open");
    empty.createEl("h3", { text: "Wybierz wiadomość" });
    empty.createEl("p", {
      cls: "tl-muted-sm",
      text: "Kliknij wiadomość na liście lub użyj klawiszy J / K, aby przeglądać pocztę. Naciśnij ?, aby zobaczyć skróty klawiszowe.",
    });
    return;
  }

  // Natychmiastowy (0 ms) podgląd nagłówka nowego maila + czysty skeleton loader podczas pobierania z IMAP
  if (!selectedEmail && selectedHeader) {
    const reader = pane.createDiv({ cls: "tl-reader-shell" });
    const scrollBody = reader.createDiv({ cls: "tl-reader-scroll" });
    const container = scrollBody.createDiv({ cls: "tl-reader-inner" });

    const headCard = container.createDiv({ cls: "tl-reader-header-card" });
    const subjectRow = headCard.createDiv({ cls: "tl-reader-subject-row" });
    subjectRow.createEl("h2", {
      cls: "tl-reader-subject",
      text: selectedHeader.subject || "(Bez tematu)",
    });
    if (loadingMessage) {
      const spin = subjectRow.createSpan({
        cls: "tl-mini-spinner",
        attr: { "aria-label": "Pobieranie treści wiadomości..." },
      });
      setIcon(spin, "loader-2");
    }

    const senderBar = headCard.createDiv({ cls: "tl-reader-sender-bar" });
    const av = getDeterministicAvatar(selectedHeader.fromName, selectedHeader.fromEmail);
    const avatar = senderBar.createDiv({ cls: "tl-avatar tl-avatar-lg", text: av.initials });
    avatar.style.backgroundColor = av.color;

    const senderInfo = senderBar.createDiv({ cls: "tl-reader-sender-info" });
    const senderTop = senderInfo.createDiv({ cls: "tl-reader-sender-top" });
    senderTop.createSpan({
      cls: "tl-sender-copy-btn",
      text: selectedHeader.fromName || selectedHeader.fromEmail || "Nieznany",
    });
    if (selectedHeader.fromEmail && selectedHeader.fromEmail !== selectedHeader.fromName) {
      senderTop.createSpan({ cls: "tl-sender-email", text: `<${selectedHeader.fromEmail}>` });
    }
    if (selectedHeader.accountLabel) {
      const accTag = senderTop.createSpan({
        cls: "tl-account-mini-badge",
        text: selectedHeader.accountLabel,
      });
      if (selectedHeader.accountColor) {
        accTag.style.borderColor = selectedHeader.accountColor;
        accTag.style.color = selectedHeader.accountColor;
      }
    }
    senderInfo.createDiv({
      cls: "tl-reader-recipient-line tl-muted-sm",
      text: selectedHeader.toEmail ? `Do: ${selectedHeader.toEmail}` : "Pobieranie szczegółów...",
    });

    const dateCol = senderBar.createDiv({ cls: "tl-reader-date-col" });
    dateCol.createDiv({
      cls: "tl-reader-date-primary",
      text: formatRelativeDatePl(selectedHeader.internalDateIso, selectedHeader.date),
    });
    dateCol.createDiv({
      cls: "tl-muted-xs",
      text: formatBytes(selectedHeader.sizeBytes),
    });

    const skel = container.createDiv({ cls: "tl-skeleton-card" });
    skel.createDiv({ cls: "tl-skeleton-line is-w85" });
    skel.createDiv({ cls: "tl-skeleton-line is-w100" });
    skel.createDiv({ cls: "tl-skeleton-line is-w70" });
    skel.createDiv({ cls: "tl-skeleton-block" });
    skel.createDiv({ cls: "tl-skeleton-line is-w60" });
    return;
  }

  if (!selectedEmail) {
    const loadingBox = pane.createDiv({ cls: "tl-reader-empty" });
    const spin = loadingBox.createDiv({ cls: "tl-mini-spinner tl-spinner-lg" });
    setIcon(spin, "loader-2");
    loadingBox.createEl("p", { cls: "tl-muted-sm", text: "Pobieranie treści wiadomości..." });
    return;
  }

  const email = selectedEmail;
  const proposal = plugin.aiBridge.analyzeContent(email.subject, email.strippedMarkdownBody);
  const folderRole = email.folder ? detectFolderRole(email.folder) : "custom";
  const isTrashOrSpam = folderRole === "trash" || folderRole === "spam";

  const reader = pane.createDiv({ cls: "tl-reader-shell" });

  // 1. Pogrupowany pasek akcji (Odpowiedź | Organizacja | Obsidian | Tryb wyświetlania)
  const toolbar = reader.createDiv({ cls: "tl-reader-toolbar" });
  const leftBar = toolbar.createDiv({ cls: "tl-toolbar-group" });

  const addToolBtn = (
    parent: HTMLElement,
    icon: string,
    title: string,
    onClick: () => void,
    opts?: { label?: string; primary?: boolean; danger?: boolean; active?: boolean }
  ) => {
    const btn = parent.createEl("button", {
      type: "button",
      cls: `tl-tool-btn${opts?.primary ? " mod-cta" : ""}${opts?.danger ? " is-danger" : ""}${
        opts?.active ? " is-active" : ""
      }`,
      attr: { "aria-label": title, title },
    });
    const ic = btn.createSpan({ cls: "tl-tool-icon" });
    setIcon(ic, icon);
    if (opts?.label) {
      btn.createSpan({ text: opts.label });
    }
    btn.addEventListener("click", onClick);
  };

  // Sekcja 1: Odpowiedź
  addToolBtn(leftBar, "reply", "Odpowiedz (R)", () => onComposeAction(email, "reply"));
  addToolBtn(leftBar, "reply-all", "Odpowiedz wszystkim (A)", () =>
    onComposeAction(email, "reply-all")
  );
  addToolBtn(leftBar, "forward", "Przekaż (F)", () => onComposeAction(email, "forward"));

  // Sekcja 2: Organizacja
  if (!offlineMode && email.uid && email.folder) {
    leftBar.createSpan({ cls: "tl-toolbar-sep" });
    if (isTrashOrSpam) {
      addToolBtn(leftBar, "inbox", "Przywróć do Odebranych", () => onRestoreFromTrash(email), {
        label: "Przywróć",
      });
      if (folderRole === "spam") {
        addToolBtn(leftBar, "shield-check", "To nie jest spam", () => onToggleSpam(email, false));
      }
      addToolBtn(leftBar, "trash-2", "Usuń trwale (Del)", () => onDelete(email), {
        danger: true,
        label: "Usuń trwale",
      });
    } else {
      addToolBtn(leftBar, "archive", "Archiwizuj (E)", () => onArchive(email));
      addToolBtn(leftBar, "shield-alert", "Oznacz jako Spam", () => onToggleSpam(email, true));
      addToolBtn(leftBar, "trash-2", "Usuń do Kosza (Del)", () => onDelete(email), {
        danger: true,
      });
    }

    addToolBtn(leftBar, "folder-input", "Przenieś do folderu...", () => onMoveToFolder(email));
    addToolBtn(
      leftBar,
      email.seen ? "mail" : "mail-open",
      email.seen ? "Oznacz jako nieprzeczytane (U)" : "Oznacz jako przeczytane (U)",
      () => onToggleSeen(email)
    );
    addToolBtn(
      leftBar,
      "star",
      email.flagged ? "Usuń gwiazdkę (S)" : "Dodaj gwiazdkę (S)",
      () => onToggleStar(email),
      { active: Boolean(email.flagged) }
    );
  }

  // Sekcja 3: Obsidian
  leftBar.createSpan({ cls: "tl-toolbar-sep" });
  addToolBtn(
    leftBar,
    "bookmark-plus",
    "Zapisz wiadomość jako notatkę w Vaulcie (Opt-in)",
    () => onSaveOptIn(email, proposal),
    { label: "Zapisz w Vaulcie", primary: true }
  );
  addToolBtn(leftBar, "code", "Źródło EML / nagłówki", () => onViewRawSource(email));

  // Prawa strona: 3-stanowy przełącznik trybu treści (zawija się czysto, nigdy nie przycina krawędzi)
  const rightBar = toolbar.createDiv({ cls: "tl-toolbar-group tl-toolbar-right" });
  const segmented = rightBar.createDiv({ cls: "tl-segmented" });

  const addSeg = (mode: ReaderViewTheme, label: string, icon: string, tooltip: string) => {
    const b = segmented.createEl("button", {
      type: "button",
      cls: `tl-seg-btn${themeMode === mode ? " is-active" : ""}`,
      attr: { title: tooltip, "aria-label": tooltip },
    });
    const ic = b.createSpan({ cls: "tl-seg-icon" });
    setIcon(ic, icon);
    b.createSpan({ text: label });
    b.addEventListener("click", () => onSetThemeMode(mode));
  };

  addSeg("original-light", "Jasny", "sun", "Oryginalny widok (jasny)");
  addSeg("force-dark", "Ciemny", "moon", "Wymuś tryb ciemny");
  addSeg("markdown", "Markdown", "file-text", "Czysty tekst (Markdown)");

  // 2. Scrollowalna treść wiadomości
  const scrollBody = reader.createDiv({ cls: "tl-reader-scroll" });
  const container = scrollBody.createDiv({ cls: "tl-reader-inner" });

  // Nagłówek wiadomości
  const headCard = container.createDiv({ cls: "tl-reader-header-card" });
  const subjectRow = headCard.createDiv({ cls: "tl-reader-subject-row" });
  subjectRow.createEl("h2", { cls: "tl-reader-subject", text: email.subject || "(Bez tematu)" });
  if (loadingMessage) {
    const spin = subjectRow.createSpan({ cls: "tl-mini-spinner" });
    setIcon(spin, "loader-2");
  }

  const senderBar = headCard.createDiv({ cls: "tl-reader-sender-bar" });
  const av = getDeterministicAvatar(email.fromName, email.fromEmail);
  const avatar = senderBar.createDiv({ cls: "tl-avatar tl-avatar-lg", text: av.initials });
  avatar.style.backgroundColor = av.color;

  const senderInfo = senderBar.createDiv({ cls: "tl-reader-sender-info" });
  const senderTop = senderInfo.createDiv({ cls: "tl-reader-sender-top" });
  const senderBtn = senderTop.createEl("button", {
    type: "button",
    cls: "tl-sender-copy-btn",
    text: email.fromName || email.fromEmail || "Nieznany",
    attr: { title: `Kliknij, aby skopiować adres: ${email.fromEmail}` },
  });
  senderBtn.addEventListener("click", () => {
    if (!email.fromEmail) return;
    void navigator.clipboard?.writeText(email.fromEmail);
    new Notice(`Skopiowano adres: ${email.fromEmail}`);
  });
  if (email.fromEmail && email.fromEmail !== email.fromName) {
    senderTop.createSpan({ cls: "tl-sender-email", text: `<${email.fromEmail}>` });
  }
  if (email.accountLabel) {
    const accTag = senderTop.createSpan({
      cls: "tl-account-mini-badge",
      text: email.accountLabel,
    });
    if (email.accountColor) {
      accTag.style.borderColor = email.accountColor;
      accTag.style.color = email.accountColor;
    }
  }

  const recipientSummary = senderInfo.createDiv({ cls: "tl-reader-recipient-line" });
  recipientSummary.createSpan({
    text: `Do: ${email.toRaw || "—"}`,
    cls: "tl-muted-sm",
  });
  const detailsToggle = recipientSummary.createEl("button", {
    type: "button",
    cls: "tl-link-btn",
    text: showDetails ? "Ukryj szczegóły" : "Szczegóły",
  });
  detailsToggle.addEventListener("click", onToggleDetails);

  const dateCol = senderBar.createDiv({ cls: "tl-reader-date-col" });
  dateCol.createDiv({
    cls: "tl-reader-date-primary",
    text: formatRelativeDatePl(email.dateTimeIso, email.date),
  });
  dateCol.createDiv({
    cls: "tl-muted-xs",
    text: formatBytes(email.sizeBytes),
  });

  if (showDetails) {
    const detailsBox = headCard.createDiv({ cls: "tl-reader-details-grid" });
    const addDetail = (label: string, value: string) => {
      if (!value) return;
      detailsBox.createDiv({ cls: "tl-detail-label", text: label });
      detailsBox.createDiv({ cls: "tl-detail-val", text: value });
    };
    addDetail("Od", email.fromRaw);
    addDetail("Do", email.toRaw);
    if (email.ccRaw) addDetail("DW (Cc)", email.ccRaw);
    if (email.replyToRaw) addDetail("Reply-To", email.replyToRaw);
    addDetail(
      "Data",
      email.dateTimeIso ? new Date(email.dateTimeIso).toLocaleString("pl-PL") : email.date
    );
    if (email.folder) addDetail("Folder", email.folder);
    if (email.messageId) addDetail("Message-ID", email.messageId);
  }

  // Kompaktowy, zwijalny pasek sugestii AI
  if (plugin.settings.aiCategorizationEnabled) {
    const aiBar = headCard.createDiv({
      cls: `tl-reader-ai-bar${aiBarCollapsed ? " is-collapsed" : ""}`,
    });
    const aiIcon = aiBar.createSpan({ cls: "tl-tool-icon" });
    setIcon(aiIcon, "sparkles");
    if (aiBarCollapsed) {
      aiBar.createSpan({
        cls: "tl-muted-xs",
        text: `Sugestia AI: ${proposal.category} (${proposal.priority})`,
      });
    } else {
      aiBar.createSpan({
        cls: "tl-ai-bar-text",
        text: `${proposal.category} · Priorytet: ${proposal.priority} · Folder: ${proposal.suggestedImapFolder}`,
      });
      if (!offlineMode && email.uid && email.folder) {
        const moveAiBtn = aiBar.createEl("button", {
          type: "button",
          cls: "tl-btn-subtle",
          text: "Przenieś wg AI",
        });
        moveAiBtn.addEventListener("click", () => onApplyAiMove(email, proposal));
      }
    }
    const collapseAiBtn = aiBar.createEl("button", {
      type: "button",
      cls: "tl-icon-btn-xs tl-ai-toggle-btn",
      attr: {
        title: aiBarCollapsed ? "Rozwiń sugestię AI" : "Zwiń pasek sugestii AI",
        "aria-label": aiBarCollapsed ? "Rozwiń sugestię AI" : "Zwiń pasek sugestii AI",
      },
    });
    setIcon(collapseAiBtn, aiBarCollapsed ? "chevron-down" : "chevron-up");
    collapseAiBtn.addEventListener("click", onToggleAiBar);
  }

  // 3. Załączniki jako nowoczesne chipy
  if (email.attachments.length > 0) {
    const attSection = container.createDiv({ cls: "tl-attachments-bar" });
    const attHead = attSection.createDiv({ cls: "tl-attachments-head" });
    attHead.createSpan({
      cls: "tl-attachments-title",
      text: `Załączniki (${email.attachments.length})`,
    });
    if (email.attachments.length > 1) {
      const saveAllBtn = attHead.createEl("button", {
        type: "button",
        cls: "tl-btn-subtle",
        text: "Zapisz wszystkie w Vaulcie",
      });
      saveAllBtn.addEventListener("click", () => onSaveAllAttachments(email));
    }

    const chipsWrap = attSection.createDiv({ cls: "tl-attachments-chips" });
    for (const att of email.attachments) {
      const dangerous = isDangerousAttachmentExtension(att.filename);
      const chip = chipsWrap.createDiv({
        cls: `tl-att-chip${dangerous ? " is-dangerous" : ""}`,
      });
      const iconEl = chip.createSpan({ cls: "tl-att-chip-icon" });
      setIcon(
        iconEl,
        dangerous ? "alert-triangle" : iconForAttachment(att.filename, att.contentType)
      );

      const info = chip.createDiv({ cls: "tl-att-chip-info" });
      info.createDiv({
        cls: "tl-att-chip-name",
        text: att.filename,
        attr: { title: att.filename },
      });
      info.createDiv({
        cls: "tl-att-chip-meta",
        text: `${formatBytes(att.size)}${att.lazy ? " · na żądanie" : ""}`,
      });

      const chipActions = chip.createDiv({ cls: "tl-att-chip-actions" });
      if (isPreviewableAttachment(att.filename, att.contentType) && !dangerous) {
        const prevBtn = chipActions.createEl("button", {
          type: "button",
          cls: "tl-icon-btn-xs",
          attr: { "aria-label": "Podgląd", title: "Podgląd w Obsidianie" },
        });
        setIcon(prevBtn, "eye");
        prevBtn.addEventListener("click", () => onPreviewAttachment(email, att));
      }

      const vaultBtn = chipActions.createEl("button", {
        type: "button",
        cls: "tl-icon-btn-xs",
        attr: { "aria-label": "Zapisz w Vaulcie", title: "Zapisz w Vaulcie" },
      });
      setIcon(vaultBtn, "folder-down");
      vaultBtn.addEventListener("click", () => onSaveAttachmentToVault(email, att));

      const diskBtn = chipActions.createEl("button", {
        type: "button",
        cls: "tl-icon-btn-xs",
        attr: { "aria-label": "Pobierz na dysk", title: "Pobierz na dysk" },
      });
      setIcon(diskBtn, "download");
      diskBtn.addEventListener("click", () => onDownloadAttachmentToDisk(email, att));
    }
  }

  // 4. Treść wiadomości: zawsze świeży izolowany <iframe> (bez skryptów i bez same-origin) LUB Markdown
  const senderEmailLower = (email.fromEmail || "").trim().toLowerCase();
  const isSenderTrusted =
    Boolean(senderEmailLower) &&
    (plugin.settings.trustedImageSenders || []).some(
      (s) => s.trim().toLowerCase() === senderEmailLower
    );

  const renderEmailBody = (targetEl: HTMLElement, msg: ParsedEmailMessage, isMainBody: boolean) => {
    if (themeMode !== "markdown" && msg.htmlBody) {
      const blockRemote =
        plugin.settings.blockRemoteImagesByDefault && !allowRemoteImages && !isSenderTrusted;
      const sanitized = sanitizeHtmlForSandbox(msg.htmlBody, blockRemote, themeMode);

      if (sanitized.blockedRemoteImagesCount > 0) {
        const banner = targetEl.createDiv({ cls: "tl-remote-img-banner" });
        const bIcon = banner.createSpan({ cls: "tl-tool-icon" });
        setIcon(bIcon, "shield");
        banner.createSpan({
          cls: "tl-remote-img-text",
          text: `Zablokowano ${sanitized.blockedRemoteImagesCount} zdalnych obrazków i pikseli śledzących.`,
        });
        const bActions = banner.createDiv({ cls: "tl-btn-row" });
        const onceBtn = bActions.createEl("button", {
          type: "button",
          cls: "tl-btn-subtle",
          text: "Pokaż raz",
        });
        onceBtn.addEventListener("click", onAllowRemoteImagesOnce);

        if (msg.fromEmail) {
          const trustBtn = bActions.createEl("button", {
            type: "button",
            cls: "tl-btn-subtle",
            text: "Zawsze ufaj nadawcy",
          });
          trustBtn.addEventListener("click", () => onTrustRemoteImagesSender(msg.fromEmail));
        }
      }

      const frameWrap = targetEl.createDiv({
        cls: `tl-html-frame-wrap${
          themeMode === "original-light" ? " is-light-surface" : " is-dark-surface"
        }`,
      });
      const iframe = frameWrap.createEl("iframe", { cls: "tl-html-frame" });
      // Bez allow-scripts i bez allow-same-origin; allow-popups pozwala bezpiecznie otwierać linki w przeglądarce
      iframe.setAttr("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      iframe.setAttr("referrerpolicy", "no-referrer");
      iframe.srcdoc = sanitized.html;

      // Płynne dopasowanie wysokości głównego kontenera podglądu do dostępnej przestrzeni okna
      if (isMainBody && typeof ResizeObserver !== "undefined") {
        const syncHeight = () => {
          if (!iframe.isConnected) {
            ro.disconnect();
            return;
          }
          const avail = Math.max(420, scrollBody.clientHeight - 210);
          iframe.style.minHeight = `${avail}px`;
        };
        const ro = new ResizeObserver(syncHeight);
        ro.observe(scrollBody);
        syncHeight();
      }
    } else {
      const mdActions = targetEl.createDiv({ cls: "tl-md-toolbar" });
      const stripBtn = mdActions.createEl("button", {
        type: "button",
        cls: "tl-btn-subtle",
        text: showStrippedMarkdown ? "Pokaż pełne cytaty" : "Oczyść cytaty (Quote-Strip)",
      });
      stripBtn.addEventListener("click", onToggleStripped);

      const bodyText = showStrippedMarkdown ? msg.strippedMarkdownBody : msg.markdownBody;
      targetEl.createDiv({
        cls: "tl-markdown-preview",
        text: bodyText || msg.textBody || "(Brak treści tekstowej)",
      });
    }
  };

  renderEmailBody(container, email, true);

  // 5. Rozwijana historia wątku — WYŁĄCZNIE zweryfikowane powiązane wiadomości z tego samego konta i wątku
  const otherMessages = filterRelatedThreadMessages(email, threadMessages).sort((a, b) => {
    const ta = a.internalDateIso ? Date.parse(a.internalDateIso) : Date.parse(a.date);
    const tb = b.internalDateIso ? Date.parse(b.internalDateIso) : Date.parse(b.date);
    return (ta || 0) - (tb || 0);
  });

  if (otherMessages.length > 0) {
    const historyWrap = container.createDiv({ cls: "tl-thread-history" });
    historyWrap.createDiv({
      cls: "tl-thread-history-title",
      text: `Wcześniejsze wiadomości w wątku (${otherMessages.length})`,
    });

    for (const h of otherMessages) {
      const expandedMsg = expandedThreadEmails.get(h.uid);
      const card = historyWrap.createDiv({
        cls: `tl-thread-history-card${expandedMsg ? " is-expanded" : ""}`,
      });
      const cardHead = card.createDiv({ cls: "tl-thread-history-head" });
      const chev = cardHead.createSpan({ cls: "tl-folder-chevron" });
      setIcon(chev, expandedMsg ? "chevron-down" : "chevron-right");

      const miniAv = getDeterministicAvatar(h.fromName, h.fromEmail);
      const avEl = cardHead.createDiv({ cls: "tl-avatar tl-avatar-sm", text: miniAv.initials });
      avEl.style.backgroundColor = miniAv.color;

      cardHead.createSpan({ cls: "tl-thread-history-sender", text: h.fromName || h.fromEmail });
      cardHead.createSpan({
        cls: "tl-thread-history-snippet",
        text: extractCleanSnippet(h.snippet || "", 90) || h.subject,
      });
      cardHead.createSpan({
        cls: "tl-muted-xs",
        text: formatRelativeDatePl(h.internalDateIso, h.date),
      });

      cardHead.addEventListener("click", () => onExpandThreadMessage(h));

      if (expandedMsg) {
        const expandedBody = card.createDiv({ cls: "tl-thread-history-body" });
        renderEmailBody(expandedBody, expandedMsg, false);
      }
    }
  }
}
