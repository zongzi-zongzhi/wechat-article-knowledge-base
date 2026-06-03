import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { H3Event } from 'h3';
import TurndownService from 'turndown';
import { normalizeHtml } from '#shared/utils/html';
import { USER_AGENT } from '~/config';
import { cookieStore } from '~/server/utils/CookieStore';
import { buildAccountIndex, buildArticleIndex } from './indexer';
import { mergeManifest, toArticleRecord } from './manifest';
import { getKnowledgeBaseRoot } from './settings';
import {
  ensureAccountStorage,
  getAccountDir,
  getArticleCoverPath,
  getArticleMarkdownPath,
  getArticleRawHtmlPath,
  readManifest,
  writeArticleCover,
  writeArticleMarkdown,
  writeArticleRawHtml,
  writeArticleSnapshot,
  writeManifest,
} from './storage';
import type {
  KnowledgeBaseArticleRecord,
  KnowledgeBaseManifest,
  SyncResult,
  UpstreamAccountSearchItem,
  UpstreamArticleItem,
} from './types';

interface SearchBizResponse {
  base_resp: { ret: number; err_msg?: string };
  list?: UpstreamAccountSearchItem[];
}

interface AppMsgPublishResponse {
  base_resp: { ret: number; err_msg?: string };
  publish_page?: string;
}

interface PublishPage {
  publish_list: Array<{ publish_info?: string }>;
  total_count: number;
}

interface PublishInfo {
  appmsgex: UpstreamArticleItem[];
}

interface SyncAccountOptions {
  includeCover?: boolean;
}

interface GlobalArticleIndexItem {
  article_id?: string;
  account_name?: string;
  title?: string;
  digest?: string;
  link?: string;
  author_name?: string;
  create_time?: number;
  update_time?: number;
  appmsgid?: string | number;
  itemidx?: string | number;
  md_path?: string;
  json_path?: string;
}

let cachedGlobalIndexByAccount: Promise<Map<string, GlobalArticleIndexItem[]>> | null = null;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function upstreamFetch<T>(event: H3Event, path: string, query: Record<string, string | number>) {
  const requestCookie = getHeader(event, 'cookie') || '';
  const latestAuthKey = await cookieStore.getLatestAuthKey();
  const cookie = requestCookie || (latestAuthKey ? `auth-key=${latestAuthKey}` : '');

  return $fetch<T>(path, {
    method: 'GET',
    query,
    headers: {
      cookie,
    },
  });
}

async function searchAccountByName(event: H3Event, accountName: string) {
  const response = await upstreamFetch<SearchBizResponse>(event, '/api/web/mp/searchbiz', {
    keyword: accountName,
    begin: 0,
    size: 5,
  });

  if (response.base_resp.ret !== 0 || !response.list?.length) {
    throw createError({
      statusCode: 400,
      statusMessage: response.base_resp.err_msg || `Unable to find account: ${accountName}`,
    });
  }

  return (
    response.list.find(item => item.nickname === accountName) ||
    response.list.find(item => item.nickname.includes(accountName)) ||
    response.list[0]
  );
}

async function fetchArticlePage(event: H3Event, fakeid: string, begin: number) {
  let response: AppMsgPublishResponse | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    response = await upstreamFetch<AppMsgPublishResponse>(event, '/api/web/mp/appmsgpublish', {
      id: fakeid,
      begin,
      size: 5,
      keyword: '',
    });

    const message = response.base_resp.err_msg || '';
    if (response.base_resp.ret === 0 || !message.toLowerCase().includes('freq')) {
      break;
    }

    await sleep(20_000 * (attempt + 1));
  }

  if (!response || response.base_resp.ret !== 0 || !response.publish_page) {
    throw createError({
      statusCode: 400,
      statusMessage: response?.base_resp.err_msg || `Unable to fetch articles for account ${fakeid}`,
    });
  }

  const publishPage = JSON.parse(response.publish_page) as PublishPage;
  const articles = publishPage.publish_list
    .filter(item => !!item.publish_info)
    .flatMap(item => JSON.parse(item.publish_info as string) as PublishInfo)
    .flatMap(item => item.appmsgex);

  return {
    articles,
    totalCount: publishPage.total_count,
  };
}

function buildExistingArticleMatcher(existingManifest: KnowledgeBaseManifest | null) {
  const existingLinks = new Set((existingManifest?.articles || []).map(article => article.link).filter(Boolean));
  const existingTitles = new Set((existingManifest?.articles || []).map(article => article.title?.trim()).filter(Boolean));
  const existingAppmsgs = new Set(
    (existingManifest?.articles || [])
      .filter(article => article.appmsgid || article.aid)
      .map(article => `${article.appmsgid || article.aid}:${article.idx || 1}`)
  );

  return (article: UpstreamArticleItem) => {
    if (article.link && existingLinks.has(article.link)) {
      return true;
    }

    if (article.title?.trim() && existingTitles.has(article.title.trim())) {
      return true;
    }

    if ((article.appmsgid || article.aid) && existingAppmsgs.has(`${article.appmsgid || article.aid}:${article.itemidx || 1}`)) {
      return true;
    }

    return false;
  };
}

async function fetchReachableArticles(
  event: H3Event,
  fakeid: string,
  existingManifest: KnowledgeBaseManifest | null,
  syncAfterTimestamp?: number | null
) {
  const collected: UpstreamArticleItem[] = [];
  let begin = 0;
  let isExistingArticle: ReturnType<typeof buildExistingArticleMatcher> | null = null;
  const hasExistingArticle = (article: UpstreamArticleItem) => {
    if (!existingManifest) {
      return false;
    }

    isExistingArticle ||= buildExistingArticleMatcher(existingManifest);
    return isExistingArticle(article);
  };

  for (let page = 0; page < 200; page++) {
    const { articles } = await fetchArticlePage(event, fakeid, begin);
    if (!articles.length) {
      break;
    }

    let reachedKnownBaseline = false;
    for (const article of articles) {
      if (syncAfterTimestamp && article.create_time && article.create_time <= syncAfterTimestamp) {
        reachedKnownBaseline = true;
        continue;
      }

      if (hasExistingArticle(article)) {
        reachedKnownBaseline = true;
        continue;
      }

      collected.push(article);
    }

    if (reachedKnownBaseline) {
      break;
    }

    begin += articles.filter(article => (article.itemidx || 1) === 1).length;
    await sleep(3_000);
  }

  return collected;
}

async function fetchArticleContent(article: KnowledgeBaseArticleRecord) {
  const rawHtml = await fetch(article.link, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
  }).then(res => res.text());

  const normalizedHtml = normalizeHtml(rawHtml, 'html');
  const turndownService = new TurndownService();
  const normalizedMarkdownBody = turndownService.turndown(normalizedHtml).trim();
  return {
    normalizedHtml,
    normalizedText: normalizeHtml(rawHtml, 'text'),
    markdownBody: normalizedMarkdownBody,
  };
}

function detectImageExtension(url: string, contentType?: string | null) {
  const normalizedType = (contentType || '').toLowerCase();
  if (normalizedType.includes('png')) {
    return '.png';
  }
  if (normalizedType.includes('webp')) {
    return '.webp';
  }
  if (normalizedType.includes('gif')) {
    return '.gif';
  }

  const cleanUrl = url.split('?')[0].toLowerCase();
  if (cleanUrl.endsWith('.png')) {
    return '.png';
  }
  if (cleanUrl.endsWith('.webp')) {
    return '.webp';
  }
  if (cleanUrl.endsWith('.gif')) {
    return '.gif';
  }

  return '.jpg';
}

async function fetchArticleCover(article: KnowledgeBaseArticleRecord) {
  if (!article.cover) {
    return null;
  }

  const response = await fetch(article.cover, {
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Origin: 'https://mp.weixin.qq.com',
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch cover image: ${response.status}`);
  }

  const extension = detectImageExtension(article.cover, response.headers.get('content-type'));
  const buffer = new Uint8Array(await response.arrayBuffer());
  return {
    extension,
    buffer,
  };
}

function buildArticleMarkdown(accountName: string, article: KnowledgeBaseArticleRecord, markdownBody: string) {
  const lines = [
    `# ${article.title}`,
    '',
    `- 公众号: ${accountName}`,
    `- 发布时间: ${new Date(article.publish_time * 1000).toLocaleString('zh-CN', { hour12: false })}`,
    `- 原文链接: ${article.link}`,
  ];

  if (article.author) {
    lines.push(`- 作者: ${article.author}`);
  }

  if (article.digest) {
    lines.push(`- 摘要: ${article.digest}`);
  }

  lines.push('', markdownBody || article.content_text || '');
  lines.push('');

  return lines.join('\n');
}

async function walkFiles(dir: string, extension: string, output: string[] = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    const target = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(target, extension, output);
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(extension)) {
      output.push(target);
    }
  }

  return output;
}

function relativeToRoot(target: string) {
  return relative(getKnowledgeBaseRoot(), target).replace(/\\/g, '/');
}

function titleFromFileName(filePath: string) {
  return filePath
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}-\d{2}\s*-\s*/, '')
    .replace(/^\d+\s*-\s*/, '')
    .trim() || filePath;
}

function formatPublishTime(timestamp: number) {
  if (!timestamp) {
    return 'unknown-date';
  }

  const date = new Date(timestamp * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}-${pad(date.getMinutes())}`;
}

function sanitizeArticleTitleForFileName(title: string) {
  return title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 90);
}

function buildArticleFileTitle(article: KnowledgeBaseArticleRecord) {
  return `${formatPublishTime(article.publish_time)} - ${sanitizeArticleTitleForFileName(article.title) || 'untitled'}`;
}

function buildArticleMatchKeys(article: Pick<KnowledgeBaseArticleRecord, 'article_id' | 'link' | 'appmsgid' | 'aid' | 'idx' | 'title'>) {
  return [
    `id:${article.article_id}`,
    article.link ? `link:${article.link}` : '',
    article.appmsgid || article.aid ? `appmsg:${article.appmsgid || article.aid}:${article.idx || 1}` : '',
    article.title ? `title:${article.title.trim()}` : '',
  ].filter(Boolean);
}

function parseDateTimeAsTimestamp(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.includes('待')) {
    return null;
  }

  const isoLike = normalized
    .replace(/（.*?）|\(.*?\)/g, '')
    .replace(/[年月]/g, '-')
    .replace(/[日]/g, ' ')
    .trim();
  const match = isoLike.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
  const timestamp = Math.floor(date.getTime() / 1000);
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function readLastContentSyncTimestamp() {
  try {
    const readmePath = join(getKnowledgeBaseRoot(), 'README.md');
    const content = await readFile(readmePath, 'utf8');
    const row = content
      .split(/\r?\n/)
      .find(line => line.includes('上次公众号内容同步') || line.includes('上次公众号内容同步时间'));
    if (!row) {
      return null;
    }

    const parts = row.split('|').map(part => part.trim()).filter(Boolean);
    const value = parts.length > 1 ? parts[1] : row;
    return parseDateTimeAsTimestamp(value);
  } catch {
    return null;
  }
}

async function readGlobalIndexByAccount() {
  if (cachedGlobalIndexByAccount) {
    return cachedGlobalIndexByAccount;
  }

  cachedGlobalIndexByAccount = (async () => {
    const byAccount = new Map<string, GlobalArticleIndexItem[]>();
    const indexPath = join(getKnowledgeBaseRoot(), '_kb_index', 'articles.jsonl');
    let content = '';

    try {
      content = await readFile(indexPath, 'utf8');
    } catch {
      return byAccount;
    }

    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      try {
        const item = JSON.parse(line) as GlobalArticleIndexItem;
        const accountName = item.account_name?.trim();
        if (!accountName) {
          continue;
        }

        const items = byAccount.get(accountName) || [];
        items.push(item);
        byAccount.set(accountName, items);
      } catch {
        continue;
      }
    }

    for (const items of byAccount.values()) {
      items.sort((a, b) => Number(b.create_time || 0) - Number(a.create_time || 0));
    }

    return byAccount;
  })();

  return cachedGlobalIndexByAccount;
}

function indexedItemToArticleRecord(accountId: string, item: GlobalArticleIndexItem, now: string): KnowledgeBaseArticleRecord {
  const appmsgid = item.appmsgid ? String(item.appmsgid) : undefined;
  const idx = Number(item.itemidx || 1);
  const articleId = `${accountId}:${appmsgid || item.article_id || `${item.create_time || 0}:${idx}`}`;

  return {
    article_id: articleId,
    appmsgid,
    idx,
    title: item.title || item.article_id || 'untitled',
    digest: item.digest || '',
    publish_time: Number(item.create_time || 0),
    link: item.link || '',
    author: item.author_name || '',
    content_text: 'existing indexed article',
    markdown_path: item.md_path || '',
    indexed: true,
    created_at: now,
    updated_at: now,
  };
}

async function readExistingGlobalIndexManifest(accountId: string, accountName: string): Promise<KnowledgeBaseManifest | null> {
  const globalIndex = await readGlobalIndexByAccount();
  const items = globalIndex.get(accountName) || [];
  if (!items.length) {
    return null;
  }

  const now = new Date().toISOString();
  const articles = items.map(item => indexedItemToArticleRecord(accountId, item, now));

  return {
    version: '1.0',
    account_name: accountName,
    account_id: accountId,
    fakeid: accountId,
    total_articles: articles.length,
    last_synced_at: now,
    sync_mode: 'initial',
    articles,
  };
}

async function readExistingLocalManifest(accountId: string, accountName: string): Promise<KnowledgeBaseManifest | null> {
  const accountDir = getAccountDir(accountId, accountName);
  const jsonFiles = await walkFiles(accountDir, '.json');
  const mdFiles = await walkFiles(accountDir, '.md');
  const byTitle = new Map<string, KnowledgeBaseArticleRecord>();
  const byJsonStem = new Map(jsonFiles.map(file => [file.replace(/\.json$/i, ''), file]));
  const now = new Date().toISOString();

  for (const mdPath of mdFiles) {
    const jsonPath = byJsonStem.get(mdPath.replace(/\.md$/i, ''));
    let meta: any = null;

    if (jsonPath && !jsonPath.endsWith('manifest.json') && !jsonPath.endsWith('account_index.json') && !jsonPath.endsWith('.index.json')) {
      try {
        meta = JSON.parse(await readFile(jsonPath, 'utf8'));
      } catch {
        meta = null;
      }
    }

    const title = (meta?.title || titleFromFileName(mdPath)).trim();
    const idx = Number(meta?.itemidx || meta?.idx || 1);
    const appmsgid = meta?.appmsgid ? String(meta.appmsgid) : undefined;
    const articleId = appmsgid ? `${accountId}:${appmsgid}` : `${accountId}:local:${relativeToRoot(mdPath)}`;

    byTitle.set(title, {
      article_id: articleId,
      appmsgid,
      idx,
      title,
      digest: meta?.digest || '',
      publish_time: Number(meta?.create_time || meta?.publish_time || 0),
      link: meta?.link || '',
      cover: meta?.cover,
      author: meta?.author_name || meta?.author,
      content_text: 'existing local article',
      raw_html_path: relativeToRoot(mdPath),
      markdown_path: relativeToRoot(mdPath),
      indexed: true,
      created_at: now,
      updated_at: now,
    });
  }

  const articles = Array.from(byTitle.values()).sort((a, b) => b.publish_time - a.publish_time);
  if (!articles.length) {
    return null;
  }

  return {
    version: '1.0',
    account_name: accountName,
    account_id: accountId,
    fakeid: accountId,
    total_articles: articles.length,
    last_synced_at: now,
    sync_mode: 'initial',
    articles,
  };
}

export async function syncAccountByName(
  event: H3Event,
  accountName: string,
  options?: SyncAccountOptions
): Promise<SyncResult> {
  const account = await searchAccountByName(event, accountName.trim());
  const accountId = account.fakeid;
  const includeCover = !!options?.includeCover;

  await ensureAccountStorage(accountId, account.nickname);

  const existingManifest =
    (await readManifest(accountId, account.nickname)) ||
    (await readExistingGlobalIndexManifest(accountId, account.nickname)) ||
    (await readExistingLocalManifest(accountId, account.nickname));
  const lastContentSyncTimestamp = await readLastContentSyncTimestamp();
  const latestKnownPublishTime = existingManifest?.articles[0]?.publish_time || null;
  const syncAfterTimestamp = Math.max(latestKnownPublishTime || 0, lastContentSyncTimestamp || 0) || null;
  const articles = await fetchReachableArticles(event, account.fakeid, existingManifest, syncAfterTimestamp);
  const incomingRecords = articles.map(article => toArticleRecord(accountId, article));

  if (!incomingRecords.length && existingManifest) {
    return {
      mode: 'incremental',
      accountId,
      accountName: existingManifest.account_name,
      fetchedCount: 0,
      newCount: 0,
      totalArticles: existingManifest.total_articles,
      lastSyncedAt: new Date().toISOString(),
    };
  }

  const { manifest, newCount, mode } = mergeManifest(existingManifest, account, incomingRecords);
  const incomingKeys = new Set(incomingRecords.flatMap(article => buildArticleMatchKeys(article)));

  for (const article of manifest.articles) {
    const isIncomingArticle = buildArticleMatchKeys(article).some(key => incomingKeys.has(key));
    const shouldFetchContent = isIncomingArticle && (!article.content_text || !article.markdown_path);
    const shouldFetchCover = isIncomingArticle && includeCover && !!article.cover && !article.cover_path;

    if (shouldFetchContent) {
      const articleFileTitle = buildArticleFileTitle(article);
      const content = await fetchArticleContent(article);
      article.content_text = content.normalizedText;
      article.raw_html_path = getArticleRawHtmlPath(
        accountId,
        article.article_id,
        manifest.account_name,
        articleFileTitle
      );
      article.markdown_path = getArticleMarkdownPath(
        accountId,
        article.article_id,
        manifest.account_name,
        articleFileTitle
      );
      article.updated_at = new Date().toISOString();
      await writeArticleRawHtml(
        accountId,
        article.article_id,
        content.normalizedHtml,
        manifest.account_name,
        articleFileTitle
      );
      await writeArticleMarkdown(
        accountId,
        article.article_id,
        buildArticleMarkdown(manifest.account_name, article, content.markdownBody),
        manifest.account_name,
        articleFileTitle
      );
      await writeArticleSnapshot(accountId, article, manifest.account_name, articleFileTitle);
      await buildArticleIndex(accountId, article, manifest.account_name);
      article.indexed = true;
    }

    if (shouldFetchCover) {
      const articleFileTitle = buildArticleFileTitle(article);
      const cover = await fetchArticleCover(article);
      if (cover) {
        article.cover_path = getArticleCoverPath(
          accountId,
          article.article_id,
          cover.extension,
          manifest.account_name,
          articleFileTitle
        );
        await writeArticleCover(
          accountId,
          article.article_id,
          cover.buffer,
          cover.extension,
          manifest.account_name,
          articleFileTitle
        );
      }
      article.updated_at = new Date().toISOString();
    }
  }

  await writeManifest(accountId, manifest, manifest.account_name);
  await buildAccountIndex(accountId, manifest.account_name);

  return {
    mode,
    accountId,
    accountName: manifest.account_name,
    fetchedCount: incomingRecords.length,
    newCount,
    totalArticles: manifest.total_articles,
    lastSyncedAt: manifest.last_synced_at,
  };
}
