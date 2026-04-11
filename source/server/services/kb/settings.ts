import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface KnowledgeBaseSettings {
  rootPath?: string;
  batchAccounts?: string[];
}

const SETTINGS_DIR = join(process.cwd(), '.data');
const SETTINGS_PATH = join(SETTINGS_DIR, 'kb-settings.json');
const DEFAULT_ROOT_PATH = resolve(process.cwd(), 'data');

let cachedSettings: KnowledgeBaseSettings | null = null;

function ensureSettingsDir() {
  mkdirSync(SETTINGS_DIR, { recursive: true });
}

function normalizeRootPath(input?: string | null) {
  const value = (input || '').trim();
  if (!value) {
    return DEFAULT_ROOT_PATH;
  }

  return resolve(value.replace(/^["']|["']$/g, ''));
}

function loadSettings() {
  if (cachedSettings) {
    return cachedSettings;
  }

  if (!existsSync(SETTINGS_PATH)) {
    cachedSettings = {};
    return cachedSettings;
  }

  try {
    cachedSettings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as KnowledgeBaseSettings;
  } catch {
    cachedSettings = {};
  }

  return cachedSettings;
}

function persistSettings(settings: KnowledgeBaseSettings) {
  ensureSettingsDir();
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  cachedSettings = settings;
}

function normalizeBatchAccounts(accounts?: string[] | null) {
  return Array.from(
    new Set(
      (accounts || [])
        .map(account => account.trim())
        .filter(Boolean)
    )
  );
}

export function getKnowledgeBaseRoot() {
  const envRoot = normalizeRootPath(process.env.DATA_DIR);
  const settings = loadSettings();

  if (settings.rootPath?.trim()) {
    return normalizeRootPath(settings.rootPath);
  }

  return envRoot || DEFAULT_ROOT_PATH;
}

export function setKnowledgeBaseRoot(rootPath: string) {
  const nextRootPath = normalizeRootPath(rootPath);
  persistSettings({
    ...loadSettings(),
    rootPath: nextRootPath,
  });

  return nextRootPath;
}

export function getKnowledgeBaseSettings() {
  return {
    rootPath: getKnowledgeBaseRoot(),
    batchAccounts: getKnowledgeBaseBatchAccounts(),
  };
}

export function getKnowledgeBaseBatchAccounts() {
  const settings = loadSettings();
  return normalizeBatchAccounts(settings.batchAccounts);
}

export function setKnowledgeBaseBatchAccounts(accounts: string[]) {
  const nextAccounts = normalizeBatchAccounts(accounts);
  persistSettings({
    ...loadSettings(),
    batchAccounts: nextAccounts,
  });

  return nextAccounts;
}
