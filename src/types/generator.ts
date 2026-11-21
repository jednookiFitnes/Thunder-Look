export type StudioTab = 'install' | 'email-settings' | 'code' | 'simulator' | 'setup';

export type MailProviderPreset = 'roundcube' | 'gmail' | 'custom';

export type PackageGroup = 'obsidian-plugin' | 'mcp-cli';

export type SaveDestinationMode = 'new-file' | 'append-note';

export type SaveScopeMode = 'full' | 'selection' | 'attachments-only';

export type AiApplyMode = 'suggest' | 'auto';

export interface ArtifactStat {
  exists: boolean;
  sizeBytes: number;
  mtime: string | null;
}

export interface BuildStatusResponse {
  plugin: {
    id: string;
    name: string;
    version: string;
    author: string;
    minAppVersion: string;
    mainJs: ArtifactStat;
    manifestJson: ArtifactStat;
    stylesCss: ArtifactStat;
    fileCount: number;
  };
  mcpCli: {
    mcpServerJs: ArtifactStat;
    cliJs: ArtifactStat;
    fileCount: number;
  };
  totals: {
    fileCount: number;
    readyForInstall: boolean;
    mcpCompiled: boolean;
  };
}

export interface RealSourceFile {
  path: string;
  group: PackageGroup;
  language: string;
  sizeBytes: number;
  lineCount: number;
  isCompiledArtifact: boolean;
  content: string;
}

export interface AiCategoryRule {
  id: string;
  label: string;
  imapFolder: string;
  vaultTopic: string;
  keywords: string;
}

export interface SimulatorConfig {
  activeProjectsDir: string;
  archiveProjectsDir: string;
  contactsDir: string;
  globalAssetsDir: string;
  projectCodeRegex: string;
  imapHost: string;
  inboxFolder: string;
  quotaWarnPercent: number;
  defaultSaveMode: SaveDestinationMode;
  attachmentsTarget: 'project-attachments' | 'global-assets';
  fileNamePattern: string;
  defaultElectricalTopic: string;
  autoDetectTasks: boolean;
  aiCategories: AiCategoryRule[];
}

export interface MockProject {
  code: string;
  client: string;
  title: string;
  folderName: string;
  masterNote: string;
  existingNotes: string[];
}

export interface MockContact {
  name: string;
  email: string;
  client: string;
  role: string;
  linkedProjects: string[];
}

export interface SampleAttachment {
  filename: string;
  sizeBytes: number;
  mimeType: string;
}

export interface SampleEmail {
  id: string;
  label: string;
  messageId: string;
  fromName: string;
  fromEmail: string;
  toName: string;
  toEmail: string;
  date: string;
  subject: string;
  body: string;
  htmlBody: string;
  attachments: SampleAttachment[];
  sizeBytes: number;
  imapFolder: string;
}

export interface StorageFolderMetric {
  folder: string;
  messages: number;
  unread: number;
  sizeBytes: number;
  largestMessageBytes: number;
}

export interface StorageMessageMetric {
  uid: number;
  folder: string;
  date: string;
  from: string;
  subject: string;
  sizeBytes: number;
  attachmentCount: number;
  projectCode: string | null;
}
