import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import {
  assertSafeSmtpHeaderValue,
  isGmailHostname,
} from "../../../shared/networkSecurity";
import { MailAuthMethod, TrinitecPluginSettings } from "../types";
import { SecretService } from "./secretService";
import { GoogleOAuthService } from "./googleOAuthService";
import { ImapService } from "./imapService";

export interface SendEmailPayload {
  to: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  subject: string;
  text: string;
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

  private async buildAuth(override?: {
    host?: string;
    user?: string;
    password?: string;
    authMethod?: MailAuthMethod;
  }): Promise<NonNullable<SMTPTransport.Options["auth"]>> {
    const host = (override?.host ?? this.settings.smtpHost).trim();
    const authMethod = override?.authMethod ?? this.settings.mailAuthMethod;
    const configuredUser = (override?.user ?? this.settings.imapUser).trim();

    if (authMethod === "google-oauth" && isGmailHostname(host)) {
      const token = await this.googleOAuthService.getValidAccessToken(
        this.settings.googleOAuthClientId
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
        : await this.secretService.getMailPassword();

    if (!configuredUser || !password) {
      throw new Error(
        "Brak konfiguracji SMTP (login lub hasło). Uzupełnij dane w ustawieniach Thunder Look."
      );
    }

    return {
      type: "LOGIN",
      user: configuredUser,
      pass: password,
    };
  }

  async sendEmail(payload: SendEmailPayload): Promise<{ messageId: string; appendedToSent: boolean }> {
    const host = this.settings.smtpHost.trim();
    if (!host) {
      throw new Error("Brak adresu serwera SMTP w ustawieniach Thunder Look.");
    }

    // Twarda walidacja wszystkich nagłówków przeciwko SMTP Header Injection (\r, \n, \0)
    const safeTo = assertSafeSmtpHeaderValue("Do (To)", payload.to);
    if (!safeTo) {
      throw new Error("Pole „Do” (odbiorca) jest wymagane.");
    }
    const safeCc = payload.cc ? assertSafeSmtpHeaderValue("DW (Cc)", payload.cc) : undefined;
    const safeBcc = payload.bcc ? assertSafeSmtpHeaderValue("UDW (Bcc)", payload.bcc) : undefined;
    const safeReplyTo = payload.replyTo
      ? assertSafeSmtpHeaderValue("Reply-To", payload.replyTo)
      : undefined;
    const safeSubject = assertSafeSmtpHeaderValue("Temat", payload.subject);
    const safeInReplyTo = payload.inReplyTo
      ? assertSafeSmtpHeaderValue("In-Reply-To", payload.inReplyTo)
      : undefined;
    const safeReferences = payload.references
      ?.map((ref) => assertSafeSmtpHeaderValue("References", ref))
      .filter(Boolean);

    const safeSenderName = this.settings.senderName
      ? assertSafeSmtpHeaderValue("Nazwa nadawcy", this.settings.senderName).replace(/"/g, "'")
      : "";
    const safeFromEmail = assertSafeSmtpHeaderValue("Nadawca", this.settings.imapUser);

    const auth = await this.buildAuth();
    const fromEmail = safeFromEmail || (auth.user || "");
    const fromFormatted = safeSenderName ? `"${safeSenderName}" <${fromEmail}>` : fromEmail;

    const safeAttachments = payload.attachments?.map((att) => ({
      filename: assertSafeSmtpHeaderValue("Nazwa załącznika", att.filename),
      content: att.content,
    }));

    const mailOptions = {
      from: fromFormatted,
      to: safeTo,
      cc: safeCc || undefined,
      bcc: safeBcc || undefined,
      replyTo: safeReplyTo || undefined,
      subject: safeSubject,
      text: payload.text,
      inReplyTo: safeInReplyTo,
      references: safeReferences && safeReferences.length > 0 ? safeReferences : undefined,
      attachments: safeAttachments,
    };

    const transportOptions: SMTPTransport.Options = {
      host,
      port: this.settings.smtpPort,
      secure: this.settings.smtpSecure,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      tls: {
        rejectUnauthorized: this.settings.strictTlsVerification,
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
    if (this.settings.appendSentToImap && !this.imapService.isGmailServer(host)) {
      try {
        const mimeBuilder = nodemailer.createTransport({ streamTransport: true, buffer: true });
        const compiled = await mimeBuilder.sendMail({
          ...mailOptions,
          messageId: info.messageId,
        });
        if (Buffer.isBuffer(compiled.message)) {
          await this.imapService.appendSentMessage(compiled.message);
          appendedToSent = true;
        }
      } catch {
        appendedToSent = false;
      }
    }

    return { messageId: info.messageId, appendedToSent };
  }

  async verifyConnection(override?: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    password?: string;
    strictTls?: boolean;
    authMethod?: MailAuthMethod;
  }): Promise<{ ok: boolean; message: string; hint?: string }> {
    const host = (override?.host ?? this.settings.smtpHost).trim();
    const port = override?.port ?? this.settings.smtpPort;
    const secure = override?.secure ?? this.settings.smtpSecure;
    const strictTls = override?.strictTls ?? this.settings.strictTlsVerification;

    if (!host) {
      return {
        ok: false,
        message: "Brak adresu serwera SMTP.",
        hint: "Wpisz serwer SMTP (np. trinitec.pl, smtp.gmail.com lub smtp.office365.com).",
      };
    }

    let transporter: nodemailer.Transporter | null = null;
    try {
      const auth = await this.buildAuth(override);
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
      const hint =
        port === 587 && secure
          ? "Port 587 używa STARTTLS — wyłącz opcję „Bezpośredni SSL/TLS” lub przełącz port na 465."
          : port === 465 && !secure
          ? "Port 465 wymaga włączonej opcji „Bezpośredni SSL/TLS”."
          : "Sprawdź nazwę hosta SMTP, port (465 SSL/TLS lub 587 STARTTLS) oraz poświadczenia.";
      return { ok: false, message: msg, hint };
    } finally {
      transporter?.close();
    }
  }
}
