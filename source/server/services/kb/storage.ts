import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AccountIndex,
  ArticleIndex,
  KnowledgeBaseArticleRecord,
  KnowledgeBaseManifest,
} from './types';
import { getKnowledgeBaseRoot } from './settings';

function getAccountsRoot() {
  return getKnowledgeBaseRoot();
}

async function pathExists(target: string) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(target: string) {
  await mkdir(target, { recursive: true });
}

async function readJsonFile<T>(target: string): Promise<T | null> {
  if (!(await pathExists(target))) {
    return null;
  }

  const content = await readFile(target, 'utf8');
  return JSON.parse(content) as T;
}

async function writeJsonFile(target: string, payload: unknown) {
  await ensureDir(join(target, '..'));
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function sanitizeAccountId(input: string) {
  return input.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
}

function sanitizeArticleFileStem(input: string) {
  const sanitized = sanitizeAccountId(input)
    .replace(/[. ]+$/g, '')
    .trim();

  return (sanitized || 'untitled').slice(0, 140);
}

function getArticleFileStem(articleId: string, articleTitle?: string) {
  return sanitizeArticleFileStem(articleTitle || articleId);
}

export function getAccountDir(accountId: string, accountName?: string) {
  return join(getAccountsRoot(), sanitizeAccountId(accountName || accountId));
}

export function getArticlesDir(accountId: string, accountName?: string) {
  return getAccountDir(accountId, accountName);
}

export function getManifestPath(accountId: string, accountName?: string) {
  return join(getAccountDir(accountId, accountName), 'manifest.json');
}

export function getAccountIndexPath(accountId: string, accountName?: string) {
  return join(getAccountDir(accountId, accountName), 'account_index.json');
}

export function getArticleDir(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  return getArticlesDir(accountId, accountName);
}

export function getArticleSnapshotPath(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  return join(getArticleDir(accountId, articleId, accountName, articleTitle), `${fileStem}.json`);
}

export function getArticleIndexPath(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  return join(getAccountDir(accountId, accountName), '_article_index', `${fileStem}.index.json`);
}

export function getArticleRawHtmlPath(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  return join(getArticleDir(accountId, articleId, accountName, articleTitle), `${fileStem}.html`);
}

export function getArticleMarkdownPath(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  return join(getArticleDir(accountId, articleId, accountName, articleTitle), `${fileStem}.md`);
}

export function getArticleCoverPath(
  accountId: string,
  articleId: string,
  extension: string,
  accountName?: string,
  articleTitle?: string
) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  return join(getArticleDir(accountId, articleId, accountName, articleTitle), `${fileStem}.cover${extension}`);
}

async function resolveArticleSnapshotPath(articleDir: string, articleId: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  const candidates = [join(articleDir, `${fileStem}.json`), join(articleDir, 'article.json')];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function resolveArticleIndexPath(articleDir: string, articleId: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  const candidates = [
    join(articleDir, '_article_index', `${fileStem}.index.json`),
    join(articleDir, `${fileStem}.index.json`),
    join(articleDir, 'article_index.json'),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function resolveArticleRawHtmlPath(articleDir: string, articleId: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  const candidates = [join(articleDir, `${fileStem}.html`), join(articleDir, 'raw.html')];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function resolveArticleMarkdownPath(articleDir: string, articleId: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  const candidates = [join(articleDir, `${fileStem}.md`), join(articleDir, 'article.md')];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return candidates[0];
}

async function resolveArticleCoverPath(articleDir: string, articleId: string, articleTitle?: string) {
  const fileStem = getArticleFileStem(articleId, articleTitle);
  const entries = await readdir(articleDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name.startsWith(`${fileStem}.cover.`) || entry.name === 'cover.jpg' || entry.name === 'cover.png' || entry.name === 'cover.webp') {
      return join(articleDir, entry.name);
    }
  }

  return join(articleDir, `${fileStem}.cover.jpg`);
}

async function moveLegacyArticleFile(
  articleDir: string,
  preferredPath: string,
  resolver: (articleDir: string, articleId: string, articleTitle?: string) => Promise<string>,
  articleId: string,
  articleTitle?: string
) {
  const resolvedPath = await resolver(articleDir, articleId, articleTitle);
  if (resolvedPath !== preferredPath && (await pathExists(resolvedPath)) && !(await pathExists(preferredPath))) {
    await rename(resolvedPath, preferredPath);
  }
}

async function resolveAccountDir(accountId: string, accountName?: string) {
  const preferredDir = getAccountDir(accountId, accountName);
  if (await pathExists(preferredDir)) {
    return preferredDir;
  }

  const legacyDir = getAccountDir(accountId);
  if (await pathExists(legacyDir)) {
    return legacyDir;
  }

  const accountsRoot = getAccountsRoot();
  if (!(await pathExists(accountsRoot))) {
    return preferredDir;
  }

  const entries = await readdir(accountsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const manifestPath = join(accountsRoot, entry.name, 'manifest.json');
    if (!(await pathExists(manifestPath))) {
      continue;
    }

    const manifest = await readJsonFile<KnowledgeBaseManifest>(manifestPath);
    if (!manifest) {
      continue;
    }

    if (manifest.account_id === accountId || manifest.fakeid === accountId || manifest.account_name === accountName) {
      return join(accountsRoot, entry.name);
    }
  }

  return preferredDir;
}

async function ensurePreferredAccountDir(accountId: string, accountName?: string) {
  const preferredDir = getAccountDir(accountId, accountName);
  const resolvedDir = await resolveAccountDir(accountId, accountName);

  if (resolvedDir !== preferredDir && (await pathExists(resolvedDir)) && !(await pathExists(preferredDir))) {
    await rename(resolvedDir, preferredDir);
    return preferredDir;
  }

  await ensureDir(preferredDir);
  return preferredDir;
}

async function resolveArticleDir(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const accountDir = await resolveAccountDir(accountId, accountName);
  const flatSnapshotPath = await resolveArticleSnapshotPath(accountDir, articleId, articleTitle);
  if (await pathExists(flatSnapshotPath)) {
    return accountDir;
  }

  const articlesDir = join(accountDir, 'articles');
  const legacyDir = join(articlesDir, sanitizeAccountId(articleId));
  if (await pathExists(legacyDir)) {
    return legacyDir;
  }

  if (!(await pathExists(articlesDir))) {
    return accountDir;
  }

  const entries = await readdir(articlesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snapshotPath = await resolveArticleSnapshotPath(join(articlesDir, entry.name), articleId, articleTitle);
    if (!(await pathExists(snapshotPath))) {
      continue;
    }

    const article = await readJsonFile<KnowledgeBaseArticleRecord>(snapshotPath);
    if (!article) {
      continue;
    }

    if (article.article_id === articleId || article.title === articleTitle) {
      return join(articlesDir, entry.name);
    }
  }

  return accountDir;
}

async function ensurePreferredArticleDir(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const accountDir = await ensurePreferredAccountDir(accountId, accountName);
  const resolvedDir = await resolveArticleDir(accountId, articleId, accountName, articleTitle);

  if (resolvedDir !== accountDir && (await pathExists(resolvedDir))) {
    return resolvedDir;
  }

  await ensureDir(accountDir);
  return accountDir;
}

export async function ensureAccountStorage(accountId: string, accountName?: string) {
  await ensurePreferredAccountDir(accountId, accountName);
}

export async function readManifest(accountId: string, accountName?: string) {
  const accountDir = await resolveAccountDir(accountId, accountName);
  return readJsonFile<KnowledgeBaseManifest>(join(accountDir, 'manifest.json'));
}

export async function writeManifest(accountId: string, manifest: KnowledgeBaseManifest, accountName?: string) {
  await ensureAccountStorage(accountId, accountName || manifest.account_name);
  await writeJsonFile(getManifestPath(accountId, accountName || manifest.account_name), manifest);
}

export async function readAccountIndex(accountId: string, accountName?: string) {
  const accountDir = await resolveAccountDir(accountId, accountName);
  return readJsonFile<AccountIndex>(join(accountDir, 'account_index.json'));
}

export async function writeAccountIndex(accountId: string, index: AccountIndex, accountName?: string) {
  await ensureAccountStorage(accountId, accountName);
  await writeJsonFile(getAccountIndexPath(accountId, accountName), index);
}

export async function readArticleIndex(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const articleDir = await resolveArticleDir(accountId, articleId, accountName, articleTitle);
  return readJsonFile<ArticleIndex>(await resolveArticleIndexPath(articleDir, articleId, articleTitle));
}

export async function writeArticleIndex(
  accountId: string,
  articleId: string,
  index: ArticleIndex,
  accountName?: string,
  articleTitle?: string
) {
  const articleDir = await ensurePreferredArticleDir(accountId, articleId, accountName, articleTitle);
  const preferredPath = getArticleIndexPath(accountId, articleId, accountName, articleTitle);
  await moveLegacyArticleFile(articleDir, preferredPath, resolveArticleIndexPath, articleId, articleTitle);
  await writeJsonFile(getArticleIndexPath(accountId, articleId, accountName, articleTitle), index);
}

export async function readArticleSnapshot(accountId: string, articleId: string, accountName?: string, articleTitle?: string) {
  const articleDir = await resolveArticleDir(accountId, articleId, accountName, articleTitle);
  return readJsonFile<KnowledgeBaseArticleRecord>(await resolveArticleSnapshotPath(articleDir, articleId, articleTitle));
}

export async function writeArticleSnapshot(
  accountId: string,
  article: KnowledgeBaseArticleRecord,
  accountName?: string,
  articleFileTitle?: string
) {
  const fileTitle = articleFileTitle || article.title;
  const articleDir = await ensurePreferredArticleDir(accountId, article.article_id, accountName, fileTitle);
  const preferredPath = getArticleSnapshotPath(accountId, article.article_id, accountName, fileTitle);
  await moveLegacyArticleFile(articleDir, preferredPath, resolveArticleSnapshotPath, article.article_id, fileTitle);
  await writeJsonFile(getArticleSnapshotPath(accountId, article.article_id, accountName, fileTitle), article);
}

export async function writeArticleRawHtml(
  accountId: string,
  articleId: string,
  rawHtml: string,
  accountName?: string,
  articleTitle?: string
) {
  const articleDir = await ensurePreferredArticleDir(accountId, articleId, accountName, articleTitle);
  const preferredPath = getArticleRawHtmlPath(accountId, articleId, accountName, articleTitle);
  await moveLegacyArticleFile(articleDir, preferredPath, resolveArticleRawHtmlPath, articleId, articleTitle);
  await writeFile(getArticleRawHtmlPath(accountId, articleId, accountName, articleTitle), rawHtml, 'utf8');
}

export async function writeArticleMarkdown(
  accountId: string,
  articleId: string,
  markdown: string,
  accountName?: string,
  articleTitle?: string
) {
  const articleDir = await ensurePreferredArticleDir(accountId, articleId, accountName, articleTitle);
  const preferredPath = getArticleMarkdownPath(accountId, articleId, accountName, articleTitle);
  await moveLegacyArticleFile(articleDir, preferredPath, resolveArticleMarkdownPath, articleId, articleTitle);
  await writeFile(getArticleMarkdownPath(accountId, articleId, accountName, articleTitle), markdown, 'utf8');
}

export async function writeArticleCover(
  accountId: string,
  articleId: string,
  payload: Uint8Array,
  extension: string,
  accountName?: string,
  articleTitle?: string
) {
  const articleDir = await ensurePreferredArticleDir(accountId, articleId, accountName, articleTitle);
  const preferredPath = getArticleCoverPath(accountId, articleId, extension, accountName, articleTitle);
  const resolvedPath = await resolveArticleCoverPath(articleDir, articleId, articleTitle);

  if (resolvedPath !== preferredPath && (await pathExists(resolvedPath)) && !(await pathExists(preferredPath))) {
    await rename(resolvedPath, preferredPath);
  }

  await writeFile(preferredPath, payload);
  return preferredPath;
}

export async function listAccountIds() {
  const accountsRoot = getAccountsRoot();
  if (!(await pathExists(accountsRoot))) {
    return [] as string[];
  }

  const entries = await readdir(accountsRoot, { withFileTypes: true });
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('_')).map(entry => entry.name);
}

export async function findAccountStorageByName(accountName: string) {
  const targetName = accountName.trim().toLowerCase();
  if (!targetName) {
    return null;
  }

  const accountIds = await listAccountIds();
  for (const accountId of accountIds) {
    const manifest = await readManifest(accountId);
    if (!manifest) {
      continue;
    }

    if (manifest.account_name.trim().toLowerCase() === targetName) {
      return {
        accountId,
        accountName: manifest.account_name,
        accountDir: await resolveAccountDir(accountId, manifest.account_name),
        manifest,
      };
    }
  }

  return null;
}
