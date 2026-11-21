export {
  buildCanonicalThreadId,
  computeContentHash,
  extractObsidianTasks,
  formatBytes,
  formatObsidianTaskLine,
  formatPolishDate,
  naturalCompare,
  normalizeLineEndings,
  normalizeSubjectForThread,
  priorityToEmoji,
  processLinesCrlfSafe,
  stripQuotesAndSignatures,
  stripQuotesAndSignaturesDetailed,
} from "../../../shared/textUtils";

export {
  assertSafeRelativeVaultPath,
  DANGEROUS_ATTACHMENT_EXTENSIONS,
  isCloudLockFile,
  isDangerousAttachmentExtension,
  sanitizeFilename,
} from "../../../shared/pathSecurity";

export {
  assertSafeSmtpHeaderValue,
  buildPolishImapErrorHint,
  isGmailHostname,
  isOutlookHostname,
  resolveServerHostFromDomain,
  sanitizeSmtpHeader,
  validateImapHostname,
  validateSafeRegexPattern,
} from "../../../shared/networkSecurity";

export { sanitizeHtmlForSandbox } from "./htmlSanitizer";
