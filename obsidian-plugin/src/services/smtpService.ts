import nodemailer from "nodemailer";
import { TrinitecPluginSettings } from "../types";
import { SecretService } from "./secretService";
import { ImapService } from "./imapService";

export interface SendEmailPayload {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export class SmtpService {
  private settings: TrinitecPluginSettings;
  private secretService: SecretService;
  private imapService: ImapService;

  constructor(
    settings: TrinitecPluginSettings,
    secretService: SecretService,
    imapService: ImapService
  ) {
    this.settings = settings;
    this.secretService = secretService;
    this.imapService = imapService;
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
  }

  async sendEmail(payload: SendEmailPayload): Promise<{ messageId: string; appendedToSent: boolean }> {
    const password = await this.secretService.getMailPassword();
    if (!this.settings.smtpHost || !this.settings.imapUser || !password) {
      throw new Error(
        "Brak konfiguracji SMTP (host, login lub hasło). Uzupełnij dane w ustawieniach wtyczki."
      );
    }

    const fromFormatted = this.settings.senderName
      ? `"${this.settings.senderName}" <${this.settings.imapUser}>`
      : this.settings.imapUser;

    const mailOptions = {
      from: fromFormatted,
      to: payload.to,
      cc: payload.cc || undefined,
      bcc: payload.bcc || undefined,
      subject: payload.subject,
      text: payload.text,
      inReplyTo: payload.inReplyTo,
      references: payload.references,
      attachments: payload.attachments,
    };

    const transporter = nodemailer.createTransport({
      host: this.settings.smtpHost,
      port: this.settings.smtpPort,
      secure: this.settings.smtpSecure,
      tls: {
        rejectUnauthorized: this.settings.strictTlsVerification,
      },
      auth: {
        user: this.settings.imapUser,
        pass: password,
      },
    });

    const info = await transporter.sendMail(mailOptions);

    // Zbuduj surowe MIME i zapisz kopię do folderu Sent przez IMAP APPEND (dla Gmaila pomijamy — SMTP sam zapisuje w Wysłanych)
    let appendedToSent = false;
    if (this.settings.appendSentToImap && !this.imapService.isGmailServer(this.settings.smtpHost)) {
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
  }): Promise<{ ok: boolean; message: string }> {
    const host = (override?.host ?? this.settings.smtpHost).trim();
    const port = override?.port ?? this.settings.smtpPort;
    const secure = override?.secure ?? this.settings.smtpSecure;
    const user = (override?.user ?? this.settings.imapUser).trim();
    const strictTls = override?.strictTls ?? this.settings.strictTlsVerification;
    const password =
      override?.password !== undefined && override.password.length > 0
        ? override.password
        : await this.secretService.getMailPassword();

    if (!host || !user || !password) {
      return { ok: false, message: "Brak danych SMTP (host, login lub hasło)." };
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        connectionTimeout: 8000,
        tls: { rejectUnauthorized: strictTls },
        auth: { user, pass: password },
      });
      await transporter.verify();
      return { ok: true, message: `Połączono z SMTP ${host}:${port} (${secure ? "SSL/TLS" : "STARTTLS"}).` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
