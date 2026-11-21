import { Notice } from "obsidian";
import { isDangerousAttachmentExtension } from "../../../../shared/pathSecurity";
import { AiAnalysisProposal, ParsedEmailMessage } from "../../types";
import { sanitizeHtmlForSandbox } from "../../utils/htmlSanitizer";
import { formatBytes } from "../../utils/textUtils";
import type TrinitecMailPlugin from "../../main";

export type ReaderRenderMode = "html" | "markdown";
export type ReplyComposeMode = "reply" | "reply-all" | "forward";

export function renderMessageReaderPane(params: {
  pane: HTMLElement;
  plugin: TrinitecMailPlugin;
  selectedEmail: ParsedEmailMessage | null;
  renderMode: ReaderRenderMode;
  allowRemoteImages: boolean;
  showStrippedMarkdown: boolean;
  offlineMode: boolean;
  onSaveOptIn: (email: ParsedEmailMessage, proposal: AiAnalysisProposal) => void;
  onComposeAction: (email: ParsedEmailMessage, mode: ReplyComposeMode) => void;
  onToggleSeen: (email: ParsedEmailMessage) => Promise<void>;
  onApplyAiMove: (email: ParsedEmailMessage, proposal: AiAnalysisProposal) => Promise<void>;
  onToggleRenderMode: () => void;
  onToggleStripped: () => void;
  onAllowRemoteImages: () => void;
}): void {
  const {
    pane,
    plugin,
    selectedEmail,
    renderMode,
    allowRemoteImages,
    showStrippedMarkdown,
    offlineMode,
    onSaveOptIn,
    onComposeAction,
    onToggleSeen,
    onApplyAiMove,
    onToggleRenderMode,
    onToggleStripped,
    onAllowRemoteImages,
  } = params;

  pane.empty();
  if (!selectedEmail) {
    const placeholder = pane.createDiv({ cls: "tl-reader" });
    placeholder.createEl("h4", { text: "Podgląd wiadomości (nieinwazyjny BODY.PEEK)" });
    placeholder.createDiv({
      cls: "tl-status-text",
      text: "Wybierz wątek z listy, aby odczytać wiadomość bez automatycznego zmieniania flagi „Przeczytane” na serwerze. Zapis do Vaulta następuje wyłącznie po kliknięciu „Zapisz w Vaulcie (Opt-in)”.",
    });
    return;
  }

  const email = selectedEmail;
  const proposal = plugin.aiBridge.analyzeContent(email.subject, email.strippedMarkdownBody);

  const reader = pane.createDiv({ cls: "tl-reader" });
  const head = reader.createDiv({ cls: "tl-reader-head" });
  head.createEl("h3", { cls: "tl-reader-title", text: email.subject });
  head.createDiv({
    cls: "tl-status-text",
    text: `Od: ${email.fromRaw} · Do: ${email.toRaw}${email.ccRaw ? ` · DW: ${email.ccRaw}` : ""} · ${email.date} · ${formatBytes(email.sizeBytes)} · Załączniki: ${email.attachments.length}`,
  });
  head.createDiv({
    cls: "tl-status-text",
    text: `Sugestia AI (bez kluczy API): ${proposal.category} · Priorytet: ${proposal.priority} · Folder IMAP: ${proposal.suggestedImapFolder}`,
  });

  const actions = head.createDiv({ cls: "tl-actions-row" });

  const saveBtn = actions.createEl("button", {
    text: "Zapisz w Vaulcie (Opt-in)",
    type: "button",
    cls: "mod-cta",
  });
  saveBtn.addEventListener("click", () => onSaveOptIn(email, proposal));

  const replyBtn = actions.createEl("button", { text: "Odpowiedz", type: "button" });
  replyBtn.addEventListener("click", () => onComposeAction(email, "reply"));

  const replyAllBtn = actions.createEl("button", { text: "Odpowiedz wszystkim", type: "button" });
  replyAllBtn.addEventListener("click", () => onComposeAction(email, "reply-all"));

  const forwardBtn = actions.createEl("button", { text: "Przekaż", type: "button" });
  forwardBtn.addEventListener("click", () => onComposeAction(email, "forward"));

  if (email.uid && email.folder && !offlineMode) {
    const seenBtn = actions.createEl("button", {
      text: email.seen ? "Oznacz nieprzeczytane" : "Oznacz przeczytane",
      type: "button",
    });
    seenBtn.addEventListener("click", () => {
      void onToggleSeen(email);
    });

    const aiMoveBtn = actions.createEl("button", {
      text: `Przenieś wg AI → ${proposal.suggestedImapFolder}`,
      type: "button",
    });
    aiMoveBtn.addEventListener("click", () => {
      void onApplyAiMove(email, proposal);
    });
  }

  const modeToggle = actions.createEl("button", {
    text: renderMode === "html" ? "Pokaż Markdown" : "Pokaż HTML Sandbox",
    type: "button",
  });
  modeToggle.addEventListener("click", onToggleRenderMode);

  if (renderMode === "markdown") {
    const stripBtn = actions.createEl("button", {
      text: showStrippedMarkdown ? "Pokaż pełne cytaty" : "Oczyść cytaty (Quote-Strip)",
      type: "button",
    });
    stripBtn.addEventListener("click", onToggleStripped);
  }

  // Izolowany podgląd HTML w <iframe sandbox=""> (BEZ allow-scripts i BEZ allow-same-origin) + DOMPurify + CSP
  if (renderMode === "html" && email.htmlBody) {
    const blockRemote = plugin.settings.blockRemoteImagesByDefault && !allowRemoteImages;
    const isDark = document.body.classList.contains("theme-dark");
    const sanitized = sanitizeHtmlForSandbox(email.htmlBody, blockRemote, isDark);

    if (sanitized.blockedRemoteImagesCount > 0) {
      const banner = reader.createDiv({ cls: "tl-banner-warn" });
      banner.createSpan({
        text: `Zablokowano ${sanitized.blockedRemoteImagesCount} zdalnych obrazków / pikseli śledzących (CSP img-src 'none').`,
      });
      const allowBtn = banner.createEl("button", {
        text: "Doładuj obrazy dla tej wiadomości",
        type: "button",
      });
      allowBtn.addEventListener("click", onAllowRemoteImages);
    }

    const iframe = reader.createEl("iframe", { cls: "tl-html-frame" });
    iframe.setAttr("sandbox", "");
    iframe.setAttr("referrerpolicy", "no-referrer");
    iframe.srcdoc = sanitized.html;
  } else {
    const bodyText = showStrippedMarkdown ? email.strippedMarkdownBody : email.markdownBody;
    reader.createDiv({
      cls: "tl-markdown-preview",
      text: bodyText,
    });
  }

  if (email.attachments.length > 0) {
    reader.createEl("h4", { text: `Załączniki (${email.attachments.length})` });
    const attRow = reader.createDiv({ cls: "tl-actions-row" });
    for (const att of email.attachments) {
      const dangerous = isDangerousAttachmentExtension(att.filename);
      const btn = attRow.createEl("button", {
        text: `${dangerous ? "⚠ " : ""}Zapisz: ${att.filename} (${formatBytes(att.size)})`,
        type: "button",
        cls: dangerous ? "tl-btn-danger" : "",
      });
      btn.addEventListener("click", async () => {
        try {
          const matched = plugin.projectMatcher.matchEmailToVault(email);
          const stored = await plugin.vaultWriter.saveAttachmentOnlyToProject(att, matched.project);
          new Notice(`Zapisano załącznik: ${stored}`);
        } catch (err) {
          new Notice(`Nie udało się zapisać załącznika: ${(err as Error).message}`);
        }
      });
    }
  }
}
