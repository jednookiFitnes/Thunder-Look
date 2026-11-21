import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Obsługa zarówno uruchomienia z src/ (tsx), jak i z dist/mcp-cli/src/ (node)
const packageRoot = __dirname.includes(`${path.sep}dist${path.sep}`)
  ? path.resolve(__dirname, '..', '..', '..')
  : path.resolve(__dirname, '..');

// Ładuj .env bez wypisywania czegokolwiek na stdout (krytyczne dla MCP stdio)
dotenv.config({
  path: path.resolve(packageRoot, '.env'),
  quiet: true,
} as dotenv.DotenvConfigOptions);

export type AnalysisMode = 'suggest' | 'auto';
export type PriorityLevel = 'high' | 'medium' | 'low';

export interface AnalysisRule {
  enabled: boolean;
  mode: AnalysisMode;
}

export interface CategoryRule {
  name: string;
  imapFolder: string;
  vaultSubfolder: string;
  defaultPriority: PriorityLevel;
  keywords: string[];
  regexPattern?: string;
}

export interface AiPolicyConfig {
  version: string;
  description: string;
  security: {
    allowImapMove: boolean;
    allowSmtpSend: boolean;
    allowVaultWrite: boolean;
    optInVaultSavingOnly: boolean;
    saveEmlCopy: boolean;
    stripQuotesForAi: boolean;
    requireExplicitConfirmationForMutations: boolean;
  };
  analyses: {
    categorization: AnalysisRule;
    folderRouting: AnalysisRule;
    taskExtraction: AnalysisRule;
    prioritization: AnalysisRule;
  };
  projectCodeRegex: string;
  categories: CategoryRule[];
}

export interface AppConfig {
  vaultPath: string;
  policyPath: string;
  imap: {
    host: string;
    port: number;
    secure: boolean;
    strictTls: boolean;
    user: string;
    password: string;
    allowlistFolder: string;
  };
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    strictTls: boolean;
    user: string;
    password: string;
    fromName: string;
  };
  vaultStructure: {
    projectsDir: string;
    archiveDir: string;
    contactsDir: string;
    assetsDir: string;
  };
}

export const DEFAULT_POLICY: AiPolicyConfig = {
  version: '1.0.0',
  description: 'Domyślna polityka Read-Only Thunder Look dla agentów AI (zero kluczy API).',
  security: {
    allowImapMove: false,
    allowSmtpSend: false,
    allowVaultWrite: false,
    optInVaultSavingOnly: true,
    saveEmlCopy: false,
    stripQuotesForAi: true,
    requireExplicitConfirmationForMutations: true,
  },
  analyses: {
    categorization: { enabled: true, mode: 'suggest' },
    folderRouting: { enabled: true, mode: 'suggest' },
    taskExtraction: { enabled: true, mode: 'suggest' },
    prioritization: { enabled: true, mode: 'suggest' },
  },
  projectCodeRegex: '\\b\\d{2}-\\d{3}\\b',
  categories: [
    {
      name: 'Zlecenie',
      imapFolder: 'INBOX/Zlecenia',
      vaultSubfolder: 'Zamówienia',
      defaultPriority: 'high',
      keywords: ['zamówienie', 'zlecenie', 'PO', 'uruchomienie', 'awaria', 'pilne'],
    },
    {
      name: 'Pytanie',
      imapFolder: 'INBOX/Pytania',
      vaultSubfolder: '',
      defaultPriority: 'medium',
      keywords: ['pytanie', 'proszę o informację', 'wyjaśnienie', 'schemat', 'termin'],
    },
    {
      name: 'Raport',
      imapFolder: 'INBOX/Raporty',
      vaultSubfolder: '',
      defaultPriority: 'low',
      keywords: ['raport', 'protokół', 'podsumowanie', 'pomiary', 'testy', 'FAT', 'SAT'],
    },
    {
      name: 'Oferta',
      imapFolder: 'INBOX/Oferty',
      vaultSubfolder: 'Zamówienia',
      defaultPriority: 'medium',
      keywords: ['oferta', 'wycena', 'RFQ', 'zapytanie ofertowe', 'kosztorys'],
    },
  ],
};

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

export function loadAppConfig(): AppConfig {
  const envPolicyPath = process.env.THUNDER_LOOK_POLICY_PATH || process.env.TRINITEC_POLICY_PATH;
  let resolvedPolicyPath: string;
  if (envPolicyPath) {
    resolvedPolicyPath = path.isAbsolute(envPolicyPath)
      ? envPolicyPath
      : path.resolve(packageRoot, envPolicyPath);
  } else {
    const localPolicy = path.resolve(packageRoot, 'ai-policy.json');
    const examplePolicy = path.resolve(packageRoot, 'ai-policy.example.json');
    resolvedPolicyPath = fs.existsSync(localPolicy) ? localPolicy : examplePolicy;
  }

  const strictTls = parseBool(process.env.STRICT_TLS_VERIFICATION, true);

  return {
    vaultPath: (process.env.OBSIDIAN_VAULT_PATH || '').trim(),
    policyPath: resolvedPolicyPath,
    imap: {
      host: process.env.IMAP_HOST || 'trinitec.pl',
      port: Number(process.env.IMAP_PORT || 993),
      secure: parseBool(process.env.IMAP_SECURE, true),
      strictTls,
      user: process.env.MAIL_USER || '',
      password: process.env.MAIL_PASSWORD || '',
      allowlistFolder: (process.env.IMAP_ALLOWLIST_FOLDER || '').trim(),
    },
    smtp: {
      host: process.env.SMTP_HOST || process.env.IMAP_HOST || 'trinitec.pl',
      port: Number(process.env.SMTP_PORT || 465),
      secure: parseBool(process.env.SMTP_SECURE, true),
      strictTls,
      user: process.env.MAIL_USER || '',
      password: process.env.MAIL_PASSWORD || '',
      fromName: process.env.MAIL_FROM_NAME || 'Piotr Świerk',
    },
    vaultStructure: {
      projectsDir: process.env.VAULT_PROJECTS_DIR || '11 - Notes - Trinitec Projekty',
      archiveDir: process.env.VAULT_ARCHIVE_DIR || '12 - Notes - Trinitec Archiwum',
      contactsDir: process.env.VAULT_CONTACTS_DIR || '11 - Notes - Trinitec Projekty/kontakty',
      assetsDir: process.env.VAULT_ASSETS_DIR || '_Assets',
    },
  };
}

export function validateAiPolicyObject(parsed: unknown): AiPolicyConfig {
  if (!parsed || typeof parsed !== 'object') {
    return DEFAULT_POLICY;
  }
  const obj = parsed as Partial<AiPolicyConfig>;
  return {
    ...DEFAULT_POLICY,
    ...obj,
    security: {
      ...DEFAULT_POLICY.security,
      ...(obj.security || {}),
    },
    analyses: {
      categorization: {
        ...DEFAULT_POLICY.analyses.categorization,
        ...(obj.analyses?.categorization || {}),
      },
      folderRouting: {
        ...DEFAULT_POLICY.analyses.folderRouting,
        ...(obj.analyses?.folderRouting || {}),
      },
      taskExtraction: {
        ...DEFAULT_POLICY.analyses.taskExtraction,
        ...(obj.analyses?.taskExtraction || {}),
      },
      prioritization: {
        ...DEFAULT_POLICY.analyses.prioritization,
        ...(obj.analyses?.prioritization || {}),
      },
    },
    categories:
      Array.isArray(obj.categories) && obj.categories.length > 0
        ? obj.categories
        : DEFAULT_POLICY.categories,
  };
}

export function loadAiPolicy(config: AppConfig): AiPolicyConfig {
  try {
    if (fs.existsSync(config.policyPath)) {
      const raw = fs.readFileSync(config.policyPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return validateAiPolicyObject(parsed);
    }
  } catch (err) {
    console.error('[thunder-look-mcp] Błąd odczytu pliku polityki AI, używam Read-Only:', err);
  }
  return DEFAULT_POLICY;
}

export function saveAiPolicy(config: AppConfig, policy: AiPolicyConfig): void {
  const dir = path.dirname(config.policyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(config.policyPath, JSON.stringify(policy, null, 2) + '\n', 'utf8');
}
