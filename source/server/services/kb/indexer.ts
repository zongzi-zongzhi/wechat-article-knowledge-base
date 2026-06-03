import {
  listAccountIds,
  readArticleIndex,
  readManifest,
  writeAccountIndex,
  writeArticleIndex,
  writeManifest,
} from './storage';
import type { AccountIndex, ArticleChunk, ArticleIndex, KnowledgeBaseArticleRecord } from './types';

export function shouldBuildArticleIndex(article: Pick<KnowledgeBaseArticleRecord, 'indexed'>, indexExists: boolean) {
  return !article.indexed || !indexExists;
}

function tokenize(text: string) {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(token => token.length >= 3)
    )
  ).slice(0, 12);
}

function buildArticleSummary(article: KnowledgeBaseArticleRecord) {
  return (article.content_text || article.digest || article.title).slice(0, 180);
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

function splitIntoChunks(text: string, articleId: string) {
  const normalized = text.replace(/\r/g, '').trim();
  if (!normalized) {
    return [] as ArticleChunk[];
  }

  const maxChunkLength = 1200;
  const chunks: ArticleChunk[] = [];
  let offset = 0;
  let chunkIndex = 0;

  while (offset < normalized.length) {
    let end = Math.min(offset + maxChunkLength, normalized.length);
    if (end < normalized.length) {
      const nextBreak = normalized.lastIndexOf('\n', end);
      if (nextBreak > offset + 200) {
        end = nextBreak;
      }
    }

    const chunkText = normalized.slice(offset, end).trim();
    if (chunkText) {
      chunks.push({
        chunk_id: `${articleId}:${chunkIndex}`,
        heading: chunkIndex === 0 ? 'opening' : `chunk-${chunkIndex + 1}`,
        summary: chunkText.slice(0, 180),
        keywords: tokenize(chunkText),
        char_start: offset,
        char_end: end,
        text_ref: `${articleId}#chunk-${chunkIndex}`,
      });
      chunkIndex++;
    }

    offset = end + 1;
  }

  return chunks;
}

export async function buildArticleIndex(accountId: string, article: KnowledgeBaseArticleRecord, accountName?: string) {
  const summary = buildArticleSummary(article);
  const sourceText = [article.title, article.digest || '', article.content_text || '', article.author || '']
    .join('\n')
    .trim();
  const chunks = splitIntoChunks(article.content_text || sourceText, article.article_id);

  const index: ArticleIndex = {
    article_id: article.article_id,
    title: article.title,
    summary,
    keywords: tokenize(sourceText),
    chunks: chunks.length
      ? chunks
      : [
          {
            chunk_id: `${article.article_id}:0`,
            heading: article.title,
            summary,
            keywords: tokenize(sourceText),
            char_start: 0,
            char_end: sourceText.length,
            text_ref: article.link,
          },
        ],
    generated_at: new Date().toISOString(),
  };

  await writeArticleIndex(accountId, article.article_id, index, accountName, buildArticleFileTitle(article));
  return index;
}

export async function buildAccountIndex(accountId: string, accountName?: string) {
  const manifest = await readManifest(accountId, accountName);
  if (!manifest) {
    throw createError({
      statusCode: 404,
      statusMessage: `Manifest not found for account ${accountId}`,
    });
  }

  const timeline = [...manifest.articles]
    .sort((a, b) => b.publish_time - a.publish_time)
    .map(article => ({
      article_id: article.article_id,
      title: article.title,
      publish_time: article.publish_time,
    }));

  const index: AccountIndex = {
    account_id: manifest.account_id,
    account_name: manifest.account_name,
    summary: `Knowledge base for ${manifest.account_name} with ${manifest.total_articles} synced articles.`,
    topics: Array.from(
      new Set(manifest.articles.flatMap(article => tokenize(`${article.title} ${article.digest || ''}`)))
    ).slice(0, 20),
    tags: Array.from(new Set(manifest.articles.flatMap(article => tokenize(article.title)))).slice(0, 20),
    timeline,
    article_refs: manifest.articles.map(article => article.article_id),
    generated_at: new Date().toISOString(),
  };

  await writeAccountIndex(accountId, index, manifest.account_name);
  return index;
}

export async function reindexAllAccounts() {
  const accountIds = await listAccountIds();
  const results = [];

  for (const accountId of accountIds) {
    const manifest = await readManifest(accountId);
    if (!manifest) {
      continue;
    }

    results.push(await reindexAccount(manifest.account_id, manifest.account_name));
  }

  return results;
}

export async function reindexAccount(accountId: string, accountName?: string) {
  const manifest = await readManifest(accountId, accountName);
  if (!manifest) {
    throw createError({
      statusCode: 404,
      statusMessage: `Manifest not found for account ${accountId}`,
    });
  }

  let articleIndexesBuilt = 0;
  for (const article of manifest.articles) {
    const existingIndex = await readArticleIndex(
      manifest.account_id,
      article.article_id,
      manifest.account_name,
      article.title
    );

    if (shouldBuildArticleIndex(article, !!existingIndex)) {
      await buildArticleIndex(manifest.account_id, article, manifest.account_name);
      article.indexed = true;
      article.updated_at = new Date().toISOString();
      articleIndexesBuilt++;
    }
  }

  await writeManifest(manifest.account_id, manifest, manifest.account_name);
  await buildAccountIndex(manifest.account_id, manifest.account_name);

  return {
    accountId: manifest.account_id,
    accountName: manifest.account_name,
    articleIndexesBuilt,
    accountIndexBuilt: true,
  };
}
