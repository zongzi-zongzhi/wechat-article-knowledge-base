import type {
  KnowledgeBaseArticleRecord,
  KnowledgeBaseManifest,
  UpstreamAccountSearchItem,
  UpstreamArticleItem,
} from './types';

export function toArticleRecord(accountId: string, article: UpstreamArticleItem): KnowledgeBaseArticleRecord {
  const articleId = `${accountId}:${article.aid || article.appmsgid || `${article.create_time}:${article.itemidx || 1}`}`;
  const now = new Date().toISOString();

  return {
    article_id: articleId,
    aid: article.aid,
    appmsgid: article.appmsgid,
    idx: article.itemidx,
    title: article.title,
    digest: article.digest,
    publish_time: article.create_time,
    link: article.link,
    cover: article.cover,
    author: article.author,
    indexed: false,
    created_at: now,
    updated_at: now,
  };
}

function mergeArticleRecord(
  existing: KnowledgeBaseArticleRecord,
  incoming: KnowledgeBaseArticleRecord
): KnowledgeBaseArticleRecord {
  return {
    ...incoming,
    content_text: existing.content_text,
    cover_path: existing.cover_path,
    raw_html_path: existing.raw_html_path,
    markdown_path: existing.markdown_path,
    indexed: existing.indexed,
    created_at: existing.created_at,
    updated_at: incoming.updated_at,
  };
}

export function mergeManifest(
  manifest: KnowledgeBaseManifest | null,
  account: UpstreamAccountSearchItem,
  incomingArticles: KnowledgeBaseArticleRecord[]
) {
  const existingArticles = manifest?.articles || [];
  const existingById = new Map(existingArticles.map(article => [article.article_id, article]));
  const existingByLink = new Map(
    existingArticles
      .filter(article => article.link)
      .map(article => [article.link, article])
  );
  const existingByAppmsg = new Map(
    existingArticles
      .filter(article => article.appmsgid || article.aid)
      .map(article => [`${article.appmsgid || article.aid}:${article.idx || 1}`, article])
  );
  const existingByTitle = new Map(
    existingArticles
      .filter(article => article.title)
      .map(article => [article.title.trim(), article])
  );
  let newCount = 0;

  for (const article of incomingArticles) {
    const existingArticle =
      existingById.get(article.article_id) ||
      (article.link ? existingByLink.get(article.link) : undefined) ||
      existingByAppmsg.get(`${article.appmsgid || article.aid}:${article.idx || 1}`) ||
      existingByTitle.get(article.title.trim());
    if (existingArticle) {
      existingById.delete(existingArticle.article_id);
      existingById.set(article.article_id, mergeArticleRecord(existingArticle, article));
      continue;
    }

    existingById.set(article.article_id, article);
    newCount++;
  }

  const mergedArticles = Array.from(existingById.values()).sort((a, b) => b.publish_time - a.publish_time);
  const syncMode = manifest ? 'incremental' : 'initial';

  const nextManifest: KnowledgeBaseManifest = {
    version: '1.0',
    account_name: account.nickname,
    account_id: account.fakeid,
    fakeid: account.fakeid,
    total_articles: mergedArticles.length,
    last_synced_at: new Date().toISOString(),
    sync_mode: syncMode,
    articles: mergedArticles,
  };

  return {
    manifest: nextManifest,
    newCount,
    mode: syncMode,
  };
}
