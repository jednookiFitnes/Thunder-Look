import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export interface ImapProbeRequest {
  host: string;
  port: number;
  secure: boolean;
  strictTls: boolean;
  user: string;
  password: string;
}

export interface ImapProbeResponse {
  ok: boolean;
  providerDetected: 'gmail' | 'roundcube' | 'imap';
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

function isBlockedPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true; // link-local
    }
    if (lower.startsWith('::ffff:')) {
      return isBlockedPrivateIp(lower.slice(7));
    }
    return false;
  }

  return true;
}

function validateHostname(host: string): string | null {
  const trimmed = host.trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) return 'Podaj poprawną nazwę hosta IMAP.';
  if (trimmed === 'localhost' || trimmed.endsWith('.local') || trimmed.endsWith('.internal')) {
    return 'Adresy lokalne i wewnętrzne nie są dozwolone w teście sieciowym.';
  }
  if (!/^[a-z0-9.-]+$/.test(trimmed)) {
    return 'Host zawiera niedozwolone znaki.';
  }
  return null;
}

function quoteImapString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
  return `"${escaped}"`;
}

function buildHint(errorMsg: string, isGmail: boolean, port: number, secure: boolean): string {
  const lower = errorMsg.toLowerCase();
  if (
    isGmail &&
    (lower.includes('auth') ||
      lower.includes('invalid credentials') ||
      lower.includes('application-specific') ||
      lower.includes('web login') ||
      lower.includes('no'))
  ) {
    return 'Gmail wymaga 16-znakowego Hasła aplikacji Google (Konto Google → Bezpieczeństwo → Weryfikacja dwuetapowa → Hasła aplikacji) zamiast zwykłego hasła do konta. Sprawdź też, czy IMAP jest włączony w ustawieniach Gmaila.';
  }
  if (lower.includes('authentication') || lower.includes('login failed') || lower.includes('invalid credentials') || lower.includes('odrzuc')) {
    return 'Serwer odrzucił login lub hasło. Upewnij się, że jako login podajesz pełny adres e-mail i aktualne hasło skrzynki.';
  }
  if (lower.includes('enotfound') || lower.includes('eai_again')) {
    return 'Nie znaleziono hosta w DNS. Sprawdź literówki w adresie serwera (np. imap.roundcube.pl lub imap.gmail.com).';
  }
  if (lower.includes('wrong version') || lower.includes('ssl') || lower.includes('tls') || lower.includes('cert')) {
    return port === 143 && secure
      ? 'Port 143 korzysta z STARTTLS — wyłącz opcję „Bezpośredni SSL/TLS” lub przełącz port na 993.'
      : 'Błąd połączenia TLS/SSL. Dla portu 993 włącz SSL/TLS, dla portu 143 użyj STARTTLS.';
  }
  if (lower.includes('timeout') || lower.includes('econnrefused')) {
    return 'Upłynął limit czasu połączenia lub serwer nie nasłuchuje na podanym porcie (standard IMAP SSL: 993).';
  }
  return 'Zweryfikuj nazwę hosta, port (993 SSL/TLS lub 143 STARTTLS) oraz dane logowania.';
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
      }, timeoutMs);

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
  const host = (req.host || '').trim();
  const port = Number(req.port);
  const secure = Boolean(req.secure);
  const strictTls = req.strictTls !== false;
  const user = (req.user || '').trim();
  const password = req.password || '';

  const isGmail =
    host.toLowerCase().includes('gmail.com') || host.toLowerCase().includes('googlemail.com');
  const providerDetected: 'gmail' | 'roundcube' | 'imap' = isGmail
    ? 'gmail'
    : host.toLowerCase().includes('roundcube')
    ? 'roundcube'
    : 'imap';

  const fail = (error: string): ImapProbeResponse => ({
    ok: false,
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
    hint: buildHint(error, isGmail, port, secure),
  });

  const hostErr = validateHostname(host);
  if (hostErr) return fail(hostErr);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return fail('Port IMAP musi być liczbą z zakresu 1–65535 (standardowo 993 lub 143).');
  }

  if (!user || !password) {
    return fail('Podaj login (adres e-mail) oraz hasło, aby zweryfikować uwierzytelnienie.');
  }

  // Ochrona przed SSRF: sprawdź wszystkie rekordy DNS przed otwarciem gniazda
  let resolvedIp: string;
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (!addresses.length) return fail('Nie udało się rozwiązać adresu IP serwera.');
    for (const entry of addresses) {
      if (isBlockedPrivateIp(entry.address)) {
        return fail('Połączenie z prywatnym lub lokalnym adresem IP jest zablokowane ze względów bezpieczeństwa.');
      }
    }
    resolvedIp = addresses[0].address;
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'Błąd rozwiązywania DNS.');
  }

  let session: ImapLineSession | null = null;
  const TIMEOUT_MS = 8000;

  try {
    const socket = await new Promise<net.Socket | tls.TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Przekroczono limit czasu nawiązania połączenia (timeout 8s).'));
      }, TIMEOUT_MS);

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
    const greeting = await session.readGreeting(TIMEOUT_MS);
    if (!greeting.startsWith('* OK')) {
      throw new Error(`Nieoczekiwana odpowiedź powitalna serwera: ${greeting}`);
    }

    let capLines = await session.sendCommand('A001', 'CAPABILITY', TIMEOUT_MS);
    let capabilities = parseCapabilities(capLines);

    if (!secure && capabilities.includes('STARTTLS')) {
      const stLines = await session.sendCommand('A002', 'STARTTLS', TIMEOUT_MS);
      const stTag = stLines[stLines.length - 1] || '';
      if (!stTag.startsWith('A002 OK')) {
        throw new Error(`Nie udało się uruchomić STARTTLS: ${stTag}`);
      }
      await session.upgradeToTls(host, strictTls);
      capLines = await session.sendCommand('A003', 'CAPABILITY', TIMEOUT_MS);
      capabilities = parseCapabilities(capLines);
    }

    const cleanedPassword = isGmail ? password.replace(/\s+/g, '') : password;
    const loginLines = await session.sendCommand(
      'A004',
      `LOGIN ${quoteImapString(user)} ${quoteImapString(cleanedPassword)}`,
      TIMEOUT_MS
    );
    const loginResult = loginLines[loginLines.length - 1] || '';
    if (!loginResult.startsWith('A004 OK')) {
      throw new Error(loginResult.replace(/^A004\s+(NO|BAD)\s*/i, '') || 'Odrzucono uwierzytelnienie IMAP.');
    }

    // Po zalogowaniu pobierz pełne rozszerzenia (np. IDLE, QUOTA, MOVE, X-GM-EXT-1)
    const postCapLines = await session.sendCommand('A005', 'CAPABILITY', TIMEOUT_MS);
    const postCaps = parseCapabilities(postCapLines);
    if (postCaps.length > 0) capabilities = postCaps;

    // Lista folderów i wykrycie \Sent (Roundcube Sent/INBOX.Sent lub Gmail [Gmail]/Sent Mail / Wysłane)
    const listLines = await session.sendCommand('A006', 'LIST "" "*"', TIMEOUT_MS);
    const { folderCount, sentFolderDetected } = parseListFolders(listLines);

    // Nieinwazyjny STATUS INBOX (nie zmienia flag \Seen)
    let inboxMessages: number | null = null;
    let inboxUnseen: number | null = null;
    try {
      const statusLines = await session.sendCommand('A007', 'STATUS "INBOX" (MESSAGES UNSEEN)', TIMEOUT_MS);
      const statusLine = statusLines.find((l) => l.toUpperCase().startsWith('* STATUS'));
      if (statusLine) {
        const msgMatch = statusLine.match(/MESSAGES\s+(\d+)/i);
        const unseenMatch = statusLine.match(/UNSEEN\s+(\d+)/i);
        if (msgMatch) inboxMessages = Number(msgMatch[1]);
        if (unseenMatch) inboxUnseen = Number(unseenMatch[1]);
      }
    } catch {
      // ignoruj
    }

    // Opcjonalnie GETQUOTAROOT (obsługiwane przez Gmail i większość serwerów Roundcube/Dovecot)
    let quotaUsedBytes: number | null = null;
    let quotaLimitBytes: number | null = null;
    if (capabilities.includes('QUOTA')) {
      try {
        const quotaLines = await session.sendCommand('A008', 'GETQUOTAROOT "INBOX"', TIMEOUT_MS);
        const qLine = quotaLines.find((l) => /STORAGE\s+\d+\s+\d+/i.test(l));
        if (qLine) {
          const m = qLine.match(/STORAGE\s+(\d+)\s+(\d+)/i);
          if (m) {
            quotaUsedBytes = Number(m[1]) * 1024;
            quotaLimitBytes = Number(m[2]) * 1024;
          }
        }
      } catch {
        // ignoruj
      }
    }

    const tlsProtocol = session.getTlsProtocol();
    await session.sendCommand('A009', 'LOGOUT', 3000).catch(() => {});

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
