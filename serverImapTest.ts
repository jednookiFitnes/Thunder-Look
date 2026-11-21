import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import {
  buildPolishImapErrorHint,
  isGmailHostname,
  isOutlookHostname,
  resolveServerHostFromDomain,
  validateImapHostname,
  validateWebImapPort,
} from './shared/networkSecurity.js';

export interface ImapProbeRequest {
  host: string;
  serverDomain?: string;
  port: number;
  secure: boolean;
  strictTls: boolean;
  user: string;
  password: string;
}

export interface ImapProbeResponse {
  ok: boolean;
  validationError?: boolean;
  providerDetected: 'gmail' | 'roundcube' | 'outlook' | 'imap';
  latencyMs: number;
  host: string;
  port: number;
  secure: boolean;
  tlsProtocol: string | null;
  greeting: string | null;
  capabilities: string[];
  folderCount: number;
  inboxMessages: number | null;
  inboxUnseen: number | null;
  sentFolderDetected: string | null;
  quotaUsedBytes: number | null;
  quotaLimitBytes: number | null;
  error?: string;
  hint?: string;
}

export function isBlockedPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    ) {
      return true; // link-local
    }
    if (lower.startsWith('::ffff:')) {
      return isBlockedPrivateIp(lower.slice(7));
    }
    return false;
  }

  return true;
}

function quoteImapString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n\0]/g, '');
  return `"${escaped}"`;
}

class ImapLineSession {
  private buffer = '';
  private socket: net.Socket | tls.TLSSocket;
  private waiters: Array<{
    resolve: (lines: string[]) => void;
    reject: (err: Error) => void;
    tag: string | null;
    collected: string[];
  }> = [];

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.attachListeners(socket);
  }

  private attachListeners(sock: net.Socket | tls.TLSSocket) {
    sock.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      if (this.buffer.length > 512 * 1024) {
        this.rejectAll(new Error('Przekroczono limit bufora odpowiedzi IMAP (512 KB).'));
        this.destroy();
        return;
      }
      this.flushLines();
    });
    sock.on('error', (err) => {
      this.rejectAll(err instanceof Error ? err : new Error(String(err)));
    });
    sock.on('close', () => {
      this.rejectAll(new Error('Serwer IMAP zamknął połączenie przed zakończeniem testu.'));
    });
  }

  upgradeToTls(servername: string, rejectUnauthorized: boolean): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const oldSocket = this.socket;
      oldSocket.removeAllListeners('data');
      oldSocket.removeAllListeners('error');
      oldSocket.removeAllListeners('close');

      const tlsSock = tls.connect(
        {
          socket: oldSocket,
          servername,
          rejectUnauthorized,
        },
        () => {
          this.socket = tlsSock;
          this.attachListeners(tlsSock);
          resolve(tlsSock);
        }
      );
      tlsSock.once('error', (err) => reject(err));
    });
  }

  getTlsProtocol(): string | null {
    if (this.socket instanceof tls.TLSSocket) {
      return this.socket.getProtocol() || 'TLS';
    }
    return null;
  }

  readGreeting(timeoutMs: number): Promise<string> {
    return this.waitForTag(null, timeoutMs).then((lines) => lines[0] || '');
  }

  sendCommand(tag: string, command: string, timeoutMs: number): Promise<string[]> {
    const promise = this.waitForTag(tag, timeoutMs);
    this.socket.write(`${tag} ${command}\r\n`);
    return promise;
  }

  destroy() {
    this.waiters = [];
    try {
      this.socket.destroy();
    } catch {
      // ignore
    }
  }

  private waitForTag(tag: string | null, timeoutMs: number): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error('Przekroczono limit czasu odpowiedzi serwera IMAP (timeout).'));
      }, Math.max(500, timeoutMs));

      const waiter = {
        tag,
        collected: [] as string[],
        resolve: (lines: string[]) => {
          clearTimeout(timer);
          resolve(lines);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      this.waiters.push(waiter);
      this.flushLines();
    });
  }

  private flushLines() {
    while (this.waiters.length > 0) {
      const idx = this.buffer.indexOf('\r\n');
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);

      const current = this.waiters[0];
      current.collected.push(line);

      if (current.tag === null) {
        this.waiters.shift();
        current.resolve(current.collected);
      } else if (
        line.startsWith(`${current.tag} OK`) ||
        line.startsWith(`${current.tag} NO`) ||
        line.startsWith(`${current.tag} BAD`)
      ) {
        this.waiters.shift();
        current.resolve(current.collected);
      }
    }
  }

  private rejectAll(err: Error) {
    const pending = [...this.waiters];
    this.waiters = [];
    for (const w of pending) {
      w.reject(err);
    }
  }
}

export async function runLiveImapProbe(req: ImapProbeRequest): Promise<ImapProbeResponse> {
  const started = Date.now();
  const HARD_DEADLINE_MS = 10_000;
  const remainingMs = () => Math.max(500, HARD_DEADLINE_MS - (Date.now() - started));

  const rawHostSource = (req.host || '').trim() || (req.serverDomain || '').trim();
  const parsed = resolveServerHostFromDomain(rawHostSource);
  const host = parsed.host;
  const port = Number(req.port || parsed.detectedPort || 993);
  const secure = parsed.detectedSecure !== null && !req.host ? parsed.detectedSecure : Boolean(req.secure);
  const strictTls = req.strictTls !== false;
  const user = (req.user || '').trim();
  const password = req.password || '';

  const isGmail = isGmailHostname(host);
  const isOutlook = isOutlookHostname(host);
  const providerDetected: 'gmail' | 'roundcube' | 'outlook' | 'imap' = isGmail
    ? 'gmail'
    : isOutlook
    ? 'outlook'
    : host.includes('roundcube')
    ? 'roundcube'
    : 'imap';

  const fail = (error: string, validationError = false): ImapProbeResponse => ({
    ok: false,
    validationError,
    providerDetected,
    latencyMs: Date.now() - started,
    host,
    port,
    secure,
    tlsProtocol: null,
    greeting: null,
    capabilities: [],
    folderCount: 0,
    inboxMessages: null,
    inboxUnseen: null,
    sentFolderDetected: null,
    quotaUsedBytes: null,
    quotaLimitBytes: null,
    error,
    hint: buildPolishImapErrorHint(error, host, port, secure),
  });

  // 1. Walidacja nazwy hosta + blokada bezpośrednich adresów prywatnych IP (ochrona SSRF)
  const hostErr = validateImapHostname(host);
  if (hostErr) return fail(hostErr, true);

  if (net.isIP(host) && isBlockedPrivateIp(host)) {
    return fail(
      'Połączenie z prywatnym lub lokalnym adresem IP jest zablokowane ze względów bezpieczeństwa (ochrona SSRF).',
      true
    );
  }

  // 2. Ścisła allowlista portów IMAP (143 / 993) — blokuje skanowanie portów przez SSRF
  const portErr = validateWebImapPort(port);
  if (portErr) return fail(portErr, true);

  if (!user || !password) {
    return fail('Podaj login (adres e-mail) oraz hasło, aby zweryfikować uwierzytelnienie.', true);
  }

  if (/[\r\n\0]/.test(user)) {
    return fail('Login zawiera niedozwolone znaki sterujące.', true);
  }

  // 3. Rozwiązanie DNS + kontrola wszystkich zwracanych rekordów IP przeciwko SSRF
  let resolvedIp: string;
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses.length) return fail('Nie udało się rozwiązać adresu IP serwera.');
    for (const entry of addresses) {
      if (isBlockedPrivateIp(entry.address)) {
        return fail(
          'Połączenie z prywatnym lub lokalnym adresem IP jest zablokowane ze względów bezpieczeństwa (ochrona SSRF).',
          true
        );
      }
    }
    resolvedIp = addresses[0].address;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Błąd rozwiązywania DNS.');
  }

  let session: ImapLineSession | null = null;
  let globalKillTimer: ReturnType<typeof setTimeout> | null = null;

  try {
    const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Przekroczono limit czasu nawiązania połączenia (timeout).'));
      }, Math.min(7000, remainingMs()));

      const onConnected = (sock: net.Socket | tls.TLSSocket) => {
        clearTimeout(timer);
        resolve(sock);
      };

      if (secure) {
        const tlsSock = tls.connect(
          {
            host: resolvedIp,
            port,
            servername: host,
            rejectUnauthorized: strictTls,
          },
          () => onConnected(tlsSock)
        );
        tlsSock.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      } else {
        const netSock = net.connect({ host: resolvedIp, port }, () => onConnected(netSock));
        netSock.once('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      }
    });

    session = new ImapLineSession(socket);
    globalKillTimer = setTimeout(() => {
      session?.destroy();
    }, remainingMs());

    const greeting = await session.readGreeting(remainingMs());
    if (!greeting.startsWith('* OK')) {
      throw new Error(`Nieoczekiwana odpowiedź powitalna serwera: ${greeting.slice(0, 120)}`);
    }

    let capLines = await session.sendCommand('A001', 'CAPABILITY', remainingMs());
    let capabilities = parseCapabilities(capLines);

    if (!secure && capabilities.includes('STARTTLS')) {
      const stLines = await session.sendCommand('A002', 'STARTTLS', remainingMs());
      const stTag = stLines[stLines.length - 1] || '';
      if (!stTag.startsWith('A002 OK')) {
        throw new Error(`Nie udało się uruchomić STARTTLS: ${stTag}`);
      }
      await session.upgradeToTls(host, strictTls);
      capLines = await session.sendCommand('A003', 'CAPABILITY', remainingMs());
      capabilities = parseCapabilities(capLines);
    }

    const cleanedPassword = isGmail ? password.replace(/\s+/g, '') : password;
    const loginLines = await session.sendCommand(
      'A004',
      `LOGIN ${quoteImapString(user)} ${quoteImapString(cleanedPassword)}`,
      remainingMs()
    );
    const loginResult = loginLines[loginLines.length - 1] || '';
    if (!loginResult.startsWith('A004 OK')) {
      throw new Error(
        loginResult.replace(/^A004\s+(NO|BAD)\s*/i, '') || 'Odrzucono uwierzytelnienie IMAP.'
      );
    }

    const postCapLines = await session.sendCommand('A005', 'CAPABILITY', remainingMs());
    const postCaps = parseCapabilities(postCapLines);
    if (postCaps.length > 0) capabilities = postCaps;

    const listLines = await session.sendCommand('A006', 'LIST "" "*"', remainingMs());
    const { folderCount, sentFolderDetected } = parseListFolders(listLines);

    let inboxMessages: number | null = null;
    let inboxUnseen: number | null = null;
    try {
      const statusLines = await session.sendCommand(
        'A007',
        'STATUS "INBOX" (MESSAGES UNSEEN)',
        remainingMs()
      );
      const statusLine = statusLines.find((l) => l.toUpperCase().startsWith('* STATUS'));
      if (statusLine) {
        const msgMatch = statusLine.match(/MESSAGES\s+(\d+)/i);
        const unseenMatch = statusLine.match(/UNSEEN\s+(\d+)/i);
        if (msgMatch) inboxMessages = Number(msgMatch[1]);
        if (unseenMatch) inboxUnseen = Number(unseenMatch[1]);
      }
    } catch {
      // opcjonalne
    }

    let quotaUsedBytes: number | null = null;
    let quotaLimitBytes: number | null = null;
    if (capabilities.includes('QUOTA')) {
      try {
        const quotaLines = await session.sendCommand('A008', 'GETQUOTAROOT "INBOX"', remainingMs());
        const qLine = quotaLines.find((l) => /STORAGE\s+\d+\s+\d+/i.test(l));
        if (qLine) {
          const m = qLine.match(/STORAGE\s+(\d+)\s+(\d+)/i);
          if (m) {
            quotaUsedBytes = Number(m[1]) * 1024;
            quotaLimitBytes = Number(m[2]) * 1024;
          }
        }
      } catch {
        // opcjonalne
      }
    }

    const tlsProtocol = session.getTlsProtocol();
    await session.sendCommand('A009', 'LOGOUT', 1500).catch(() => {});

    return {
      ok: true,
      providerDetected,
      latencyMs: Date.now() - started,
      host,
      port,
      secure,
      tlsProtocol,
      greeting: greeting.replace(/^\*\s+OK\s*/i, '').slice(0, 140),
      capabilities,
      folderCount,
      inboxMessages,
      inboxUnseen,
      sentFolderDetected,
      quotaUsedBytes,
      quotaLimitBytes,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  } finally {
    if (globalKillTimer) clearTimeout(globalKillTimer);
    session?.destroy();
  }
}

function parseCapabilities(lines: string[]): string[] {
  const capSet = new Set<string>();
  for (const line of lines) {
    const match = line.match(/CAPABILITY\s+([^\]\r\n]+)/i);
    if (match) {
      for (const token of match[1].trim().split(/\s+/)) {
        if (token) capSet.add(token.toUpperCase());
      }
    }
  }
  return Array.from(capSet).sort();
}

function parseListFolders(lines: string[]): {
  folderCount: number;
  sentFolderDetected: string | null;
} {
  let folderCount = 0;
  let sentFolderDetected: string | null = null;

  for (const line of lines) {
    if (!line.startsWith('* LIST ')) continue;
    const m = line.match(/^\*\s+LIST\s+\(([^)]*)\)\s+(?:"[^"]*"|NIL)\s+(?:"([^"]+)"|(\S+))/i);
    if (!m) continue;
    const flags = m[1] || '';
    const folderName = m[2] || m[3] || '';
    if (/\\Noselect/i.test(flags)) continue;
    folderCount++;

    if (!sentFolderDetected) {
      if (/\\Sent/i.test(flags)) {
        sentFolderDetected = folderName;
      } else if (/^(INBOX\.)?(Sent|Wysłane|Sent Items|\[Gmail\]\/(Sent Mail|Wysłane))$/i.test(folderName)) {
        sentFolderDetected = folderName;
      }
    }
  }

  return { folderCount, sentFolderDetected };
}
