import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  assertSafeSmtpHeaderValue,
  buildPolishSmtpErrorHint,
  isGmailHostname,
} from "../../../shared/networkSecurity";
import { MailAccountConfig, MailAuthMethod, TrinitecPluginSettings } from "../types";
import { getAccountById } from "../utils/settingsMigration";
import { SecretService } from "./secretService";
import { GoogleOAuthService } from "./googleOAuthService";
import { ImapService } from "./imapService";

export interface SendEmailPayload {
  accountId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{ filename: string; content: Buffer }>;
}

const SMTP_CONNECTION_TIMEOUT_MS = 12_000;
const SMTP_GREETING_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 25_000;

export class SmtpService {
  private settings: TrinitecPluginSettings;
  private secretService: SecretService;
  private googleOAuthService: GoogleOAuthService;
  private imapService: ImapService;

  constructor(
    settings: TrinitecPluginSettings,
    secretService: SecretService,
    imapService: ImapService,
    googleOAuthService?: GoogleOAuthService
  ) {
    this.settings = settings;
    this.secretService = secretService;
    this.imapService = imapService;
    this.googleOAuthService = googleOAuthService ?? new GoogleOAuthService(secretService);
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
  }

  private resolveAccount(accountId?: string): MailAccountConfig {
    return getAccountById(this.settings, accountId);
  }

  private async buildAuth(
    account: MailAccountConfig,
    override?: {
      host?: string;
      user?: string;
      password?: string;
      authMethod?: MailAuthMethod;
    }
  ): Promise<NonNullable<SMTPTransport.Options["auth"]>> {
    const host = (override?.host ?? account.smtpHost).trim();
    const authMethod = override?.authMethod ?? account.mailAuthMethod;
    const configuredUser = (override?.user ?? account.imapUser).trim();

    if (authMethod === "google-oauth" && isGmailHostname(host)) {
      const token = await this.googleOAuthService.getValidAccessToken(
        account.googleOAuthClientId || this.settings.googleOAuthClientId,
        account.id
      );
      const user = configuredUser || token.email;
      if (!user) {
        throw new Error("Brak adresu e-mail dla sesji Google OAuth2.");
      }
      return {
        type: "OAuth2",
        user,
        accessToken: token.accessToken,
      };
    }

    const password =
      override?.password !== undefined && override.password.length > 0
        ? override.password
        : await this.secretService.getMailPassword(account.id);

    if (!configuredUser || !password) {
      throw new Error(
        `Brak konfiguracji SMTP (login lub hasło) dla konta „${account.label}”. Uzupełnij dane w ustawieniach Thunder Look.`
      );
    }

    return {
      type: "LOGIN",
      user: configuredUser,
      pass: password,
    };
  }

  private sanitizeMailOptions(
    payload: SendEmailPayload,
    account: MailAccountConfig,
    fallbackUser: string,
    requireRecipient: boolean
  ) {
    const safeTo = payload.to ? assertSafeSmtpHeaderValue("Do (To)", payload.to) : "";
    if (requireRecipient && !safeTo) {
      throw new Error("Pole „Do” (odbiorca) jest wymagane.");
    }
    const safeCc = payload.cc ? assertSafeSmtpHeaderValue("DW (Cc)", payload.cc) : undefined;
    const safeBcc = payload.bcc ? assertSafeSmtpHeaderValue("UDW (Bcc)", payload.bcc) : undefined;
    const safeReplyTo = payload.replyTo
      ? assertSafeSmtpHeaderValue("Reply-To", payload.replyTo)
      : undefined;
    const safeSubject = assertSafeSmtpHeaderValue("Temat", payload.subject || "");
    const safeInReplyTo = payload.inReplyTo
      ? assertSafeSmtpHeaderValue("In-Reply-To", payload.inReplyTo)
      : undefined;
    const safeReferences = payload.references
      ?.map((ref) => assertSafeSmtpHeaderValue("References", ref))
      .filter(Boolean);

    const safeSenderName = account.senderName
      ? assertSafeSmtpHeaderValue("Nazwa nadawcy", account.senderName).replace(/"/g, "'")
      : "";
    const safeFromEmail = assertSafeSmtpHeaderValue("Nadawca", account.imapUser || fallbackUser);
    const fromEmail = safeFromEmail || fallbackUser;
    const fromFormatted = safeSenderName ? `"${safeSenderName}" <${fromEmail}>` : fromEmail;

    const safeAttachments = payload.attachments?.map((att) => ({
      filename: assertSafeSmtpHeaderValue("Nazwa załącznika", att.filename),
      content: att.content,
    }));

    return {
      from: fromFormatted,
      to: safeTo || undefined,
      cc: safeCc || undefined,
      bcc: safeBcc || undefined,
      replyTo: safeReplyTo || undefined,
      subject: safeSubject,
      text: payload.text,
      html: payload.html || undefined,
      inReplyTo: safeInReplyTo,
      references: safeReferences && safeReferences.length > 0 ? safeReferences : undefined,
      attachments: safeAttachments,
    };
  }

  /**
   * Buduje gotowy surowy bufor RFC 5322 MIME (np. do zapisu szkicu IMAP APPEND \Draft).
   */
  async buildRawMimeMessage(payload: SendEmailPayload): Promise<Buffer> {
    const account = this.resolveAccount(payload.accountId);
    const mailOptions = this.sanitizeMailOptions(payload, account, account.imapUser || "", false);
    const mimeBuilder = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const compiled = await mimeBuilder.sendMail(mailOptions);
    if (!Buffer.isBuffer(compiled.message)) {
      throw new Error("Nie udało się zbudować bufora MIME dla szkicu.");
    }
    return compiled.message;
  }

  async sendEmail(payload: SendEmailPayload): Promise<{ messageId: string; appendedToSent: boolean }> {
    const account = this.resolveAccount(payload.accountId);
    const host = account.smtpHost.trim();
    if (!host) {
      throw new Error(`Brak adresu serwera SMTP dla konta „${account.label}”.`);
    }

    const auth = await this.buildAuth(account);
    const mailOptions = this.sanitizeMailOptions(payload, account, auth.user || "", true);

    const transportOptions: SMTPTransport.Options = {
      host,
      port: account.smtpPort,
      secure: account.smtpSecure,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      tls: {
        rejectUnauthorized: account.strictTlsVerification,
        minVersion: "TLSv1.2",
      },
      auth,
    };
    const transporter = nodemailer.createTransport(transportOptions);

    let info: SMTPTransport.SentMessageInfo;
    try {
      info = (await transporter.sendMail(mailOptions)) as SMTPTransport.SentMessageInfo;
    } finally {
      transporter.close();
    }

    // Kopia do folderu Sent przez IMAP APPEND (dla Gmaila pomijamy — SMTP Gmaila sam zapisuje w Wysłanych)
    let appendedToSent = false;
    if (account.appendSentToImap && !this.imapService.isGmailServer(host, account.id)) {
      try {
        const mimeBuilder = nodemailer.createTransport({ streamTransport: true, buffer: true });
        const compiled = await mimeBuilder.sendMail({
          ...mailOptions,
          messageId: info.messageId,
        });
        if (Buffer.isBuffer(compiled.message)) {
          await this.imapService.appendSentMessage(compiled.message, account.id);
          appendedToSent = true;
        }
      } catch {
        appendedToSent = false;
      }
    }

    return { messageId: info.messageId, appendedToSent };
  }

  async verifyConnection(override?: {
    accountId?: string;
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    strictTls?: boolean;
    authMethod?: MailAuthMethod;
  }): Promise<{ ok: boolean; message: string; hint?: string }> {
    const account = this.resolveAccount(override?.accountId);
    const host = (override?.host ?? account.smtpHost).trim();
    const port = override?.port ?? account.smtpPort;
    const secure = override?.secure ?? account.smtpSecure;
    const strictTls = override?.strictTls ?? account.strictTlsVerification;

    if (!host) {
      return {
        ok: false,
        message: "Brak adresu serwera SMTP.",
        hint: "Wpisz serwer SMTP (np. trinitec.pl, smtp.gmail.com lub smtp.office365.com).",
      };
    }

    let transporter: nodemailer.Transporter | null = null;
    try {
      const auth = await this.buildAuth(account, override);
      const verifyOptions: SMTPTransport.Options = {
        host,
        port,
        secure,
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        tls: { rejectUnauthorized: strictTls, minVersion: "TLSv1.2" },
        auth,
      };
      transporter = nodemailer.createTransport(verifyOptions);
      await transporter.verify();
      return {
        ok: true,
        message: `Połączono z SMTP ${host}:${port} (${secure ? "SSL/TLS" : "STARTTLS"}).`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = buildPolishSmtpErrorHint(msg, host, port, secure);
      return { ok: false, message: msg, hint };
    } finally {
      transporter?.close();
    }
  }
}
