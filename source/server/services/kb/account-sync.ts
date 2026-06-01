import type { H3Event } from 'h3';
import TurndownService from 'turndown';
import { normalizeHtml } from '#shared/utils/html';
import { USER_AGENT } from '~/config';
import { buildAccountIndex, buildArticleIndex } from './indexer';
import { mergeManifest, toArticleRecord } from './manifest';
import {
  ensureAccountStorage,
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
import type { KnowledgeBaseArticleRecord, SyncResult, UpstreamAccountSearchItem, UpstreamArticleItem } from './types';

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

async function upstreamFetch<T>(event: H3Event, path: string, query: Record<string, string | number>) {
  return $fetch<T>(path, {
    method: 'GET',
    query,
    headers: {
      cookie: getHeader(event, 'cookie') || '',
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
  const response = await upstreamFetch<AppMsgPublishResponse>(event, '/api/web/mp/appmsgpublish', {
    id: fakeid,
    begin,
    size: 5,
    keyword: '',
  });

  if (response.base_resp.ret !== 0 || !response.publish_page) {
    throw createError({
      statusCode: 400,
      statusMessage: response.base_resp.err_msg || `Unable to fetch articles for account ${fakeid}`,
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

async function fetchReachableArticles(event: H3Event, fakeid: string) {
  const collected: UpstreamArticleItem[] = [];
  let begin = 0;

  for (let page = 0; page < 200; page++) {
    const { articles } = await fetchArticlePage(event, fakeid, begin);
    if (!articles.length) {
      break;
    }

    collected.push(...articles);
    begin += articles.filter(article => (article.itemidx || 1) === 1).length;
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

export async function syncAccountByName(
  event: H3Event,
  accountName: string,
  options?: SyncAccountOptions
): Promise<SyncResult> {
  const account = await searchAccountByName(event, accountName.trim());
  const accountId = account.fakeid;
  const includeCover = !!options?.includeCover;

  await ensureAccountStorage(accountId, account.nickname);

  const existingManifest = await readManifest(accountId, account.nickname);
  const articles = await fetchReachableArticles(event, account.fakeid);
  const incomingRecords = articles.map(article => toArticleRecord(accountId, article));
  const { manifest, newCount, mode } = mergeManifest(existingManifest, account, incomingRecords);

  const existingIds = new Set((existingManifest?.articles || []).map(article => article.article_id));

  for (const article of manifest.articles) {
    const shouldFetchContent =
      !existingIds.has(article.article_id) || !article.content_text || !article.raw_html_path || !article.markdown_path;
    const shouldFetchCover = includeCover && !!article.cover && !article.cover_path;

    if (shouldFetchContent) {
      const content = await fetchArticleContent(article);
      article.content_text = content.normalizedText;
      article.raw_html_path = getArticleRawHtmlPath(
        accountId,
        article.article_id,
        manifest.account_name,
        article.title
      );
      article.markdown_path = getArticleMarkdownPath(
        accountId,
        article.article_id,
        manifest.account_name,
        article.title
      );
      article.updated_at = new Date().toISOString();
      await writeArticleRawHtml(
        accountId,
        article.article_id,
        content.normalizedHtml,
        manifest.account_name,
        article.title
      );
      await writeArticleMarkdown(
        accountId,
        article.article_id,
        buildArticleMarkdown(manifest.account_name, article, content.markdownBody),
        manifest.account_name,
        article.title
      );
    }

    if (shouldFetchCover) {
      const cover = await fetchArticleCover(article);
      if (cover) {
        article.cover_path = getArticleCoverPath(
          accountId,
          article.article_id,
          cover.extension,
          manifest.account_name,
          article.title
        );
        await writeArticleCover(
          accountId,
          article.article_id,
          cover.buffer,
          cover.extension,
          manifest.account_name,
          article.title
        );
      }
      article.updated_at = new Date().toISOString();
    }
  }

  for (const article of manifest.articles.filter(item => !item.indexed)) {
    await buildArticleIndex(accountId, article, manifest.account_name);
    article.indexed = true;
    article.updated_at = new Date().toISOString();
  }

  for (const article of manifest.articles) {
    await writeArticleSnapshot(accountId, article, manifest.account_name);
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
