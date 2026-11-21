import { Notice, Setting } from "obsidian";
import { DiagnosticStepResult, FullDiagnosticsReport } from "../../types";
import { formatBytes } from "../../utils/textUtils";
import type TrinitecMailPlugin from "../../main";

export async function runFullConfigurationDiagnostics(
  plugin: TrinitecMailPlugin,
  draftPassword: string
): Promise<FullDiagnosticsReport> {
  const pwdToUse =
    plugin.settings.mailProvider === "gmail" && draftPassword
      ? draftPassword.replace(/\s+/g, "")
      : draftPassword || undefined;

  const steps: DiagnosticStepResult[] = [];

  // Krok A: Połączenie i logowanie IMAP + lista folderów
  const imapRes = await plugin.imapService.testConnection({
    host: plugin.settings.imapHost,
    port: plugin.settings.imapPort,
    secure: plugin.settings.imapSecure,
    user: plugin.settings.imapUser,
    password: pwdToUse,
    strictTls: plugin.settings.strictTlsVerification,
    authMethod: plugin.settings.mailAuthMethod,
  });

  if (imapRes.ok && imapRes.sentFolderDetected) {
    plugin.settings.sentFolder = imapRes.sentFolderDetected;
    await plugin.saveSettings();
  }

  const quotaInfo =
    imapRes.quotaLimitBytes && imapRes.quotaUsedBytes !== null
      ? ` · QUOTA: ${formatBytes(imapRes.quotaUsedBytes)} / ${formatBytes(imapRes.quotaLimitBytes)}`
      : "";

  steps.push({
    step: "imap",
    label: "1. Połączenie i logowanie IMAP + foldery",
    ok: imapRes.ok,
    summary: imapRes.ok
      ? `Połączono z ${imapRes.host}:${imapRes.port} (${imapRes.latencyMs} ms) — ${imapRes.folderCount} folderów, INBOX: ${imapRes.inboxMessages} (${imapRes.inboxUnseen} nieprzecz.)${quotaInfo}`
      : `Błąd IMAP (${imapRes.host}:${imapRes.port}): ${imapRes.error || "nieznany błąd"}`,
    details: imapRes.ok
      ? `Wykryty folder Sent: ${imapRes.sentFolderDetected || "domyślny"}`
      : undefined,
    hint: imapRes.hint,
  });

  // Krok B: Połączenie SMTP
  const smtpRes = await plugin.smtpService.verifyConnection({
    host: plugin.settings.smtpHost,
    port: plugin.settings.smtpPort,
    secure: plugin.settings.smtpSecure,
    user: plugin.settings.imapUser,
    password: pwdToUse,
    strictTls: plugin.settings.strictTlsVerification,
    authMethod: plugin.settings.mailAuthMethod,
  });

  steps.push({
    step: "smtp",
    label: "2. Połączenie i autoryzacja SMTP",
    ok: smtpRes.ok,
    summary: smtpRes.message,
    hint: smtpRes.hint,
  });

  // Krok C: Istnienie i zapisywalność folderu docelowego w Vaulcie
  const vaultRes = await plugin.vaultWriter.testDestinationWritability();
  steps.push({
    step: "vault",
    label: "3. Folder docelowy w sejfie Obsidian (zapisywalność)",
    ok: vaultRes.ok,
    summary: vaultRes.message,
    hint: vaultRes.hint,
  });

  return {
    ok: steps.every((s) => s.ok),
    ranAt: new Date().toLocaleTimeString("pl-PL"),
    steps,
    imapResult: imapRes,
  };
}

export function renderDiagnosticsPanel(params: {
  wrapper: HTMLElement;
  plugin: TrinitecMailPlugin;
  getDraftPassword: () => string;
  isTesting: boolean;
  setIsTesting: (v: boolean) => void;
  lastReport: FullDiagnosticsReport | null;
  setLastReport: (r: FullDiagnosticsReport | null) => void;
}): void {
  const {
    wrapper,
    plugin,
    getDraftPassword,
    isTesting,
    setIsTesting,
    lastReport,
    setLastReport,
  } = params;

  const resultContainer = wrapper.createDiv({ cls: "tl-test-result-slot" });

  new Setting(wrapper)
    .setName("Szybka diagnostyka krok po kroku")
    .setDesc(
      "Weryfikuje kolejno: (1) logowanie IMAP + foldery, (2) serwer SMTP oraz (3) zapisywalność folderu docelowego w Vaulcie."
    )
    .addButton((btn) => {
      btn
        .setButtonText(isTesting ? "Diagnostyka w toku..." : "Przetestuj pełną konfigurację")
        .setCta()
        .setDisabled(isTesting)
        .onClick(async () => {
          if (isTesting) return;
          setIsTesting(true);
          btn.setDisabled(true);
          btn.setButtonText("Testowanie IMAP, SMTP i Vault...");
          resultContainer.empty();
          resultContainer.createDiv({
            cls: "tl-status-text",
            text: `Trwa sprawdzanie połączenia z ${plugin.settings.imapHost} oraz uprawnień zapisu w Vaulcie...`,
          });

          try {
            const report = await runFullConfigurationDiagnostics(plugin, getDraftPassword());
            setLastReport(report);
            renderReportSteps(resultContainer, report);

            if (report.ok) {
              plugin.updateRuntimeStatus({
                state: "connected",
                lastSyncAt: new Date(),
                unreadCount: report.imapResult.inboxUnseen,
                lastError: null,
              });
              new Notice("Pełna diagnostyka Thunder Look zakończona sukcesem (3/3).");
            } else {
              const failedCount = report.steps.filter((s) => !s.ok).length;
              new Notice(`Diagnostyka wykryła ${failedCount} problem(y) — sprawdź podpowiedzi poniżej.`);
            }
          } finally {
            setIsTesting(false);
            btn.setDisabled(false);
            btn.setButtonText("Przetestuj pełną konfigurację");
          }
        });
    });

  if (lastReport) {
    renderReportSteps(resultContainer, lastReport);
  }
}

function renderReportSteps(container: HTMLElement, report: FullDiagnosticsReport): void {
  container.empty();
  const box = container.createDiv({
    cls: `tl-test-result ${report.ok ? "is-success" : "is-error"}`,
  });

  box.createDiv({
    cls: "tl-test-result-title",
    text: report.ok
      ? `Wszystkie testy zakończone pomyślnie (${report.ranAt})`
      : `Wykryto problemy w konfiguracji (${report.ranAt})`,
  });

  for (const step of report.steps) {
    const row = box.createDiv({
      cls: `tl-diag-step ${step.ok ? "is-ok" : "is-fail"}`,
    });
    row.createDiv({
      cls: "tl-diag-step-head",
      text: `${step.ok ? "✓" : "✕"} ${step.label}`,
    });
    row.createDiv({ cls: "tl-test-result-line", text: step.summary });
    if (step.details) {
      row.createDiv({ cls: "tl-test-result-line", text: step.details });
    }
    if (!step.ok && step.hint) {
      row.createDiv({ cls: "tl-test-result-hint", text: `Podpowiedź: ${step.hint}` });
    }
  }
}
