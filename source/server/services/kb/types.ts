export interface KnowledgeBaseArticleRecord {
  article_id: string;
  aid?: string;
  appmsgid?: string;
  idx?: number;
  title: string;
  digest?: string;
  publish_time: number;
  link: string;
  cover?: string;
  author?: string;
  content_text?: string;
  cover_path?: string;
  raw_html_path?: string;
  markdown_path?: string;
  indexed: boolean;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBaseManifest {
  version: string;
  account_name: string;
  account_id: string;
  fakeid: string;
  total_articles: number;
  last_synced_at: string;
  sync_mode: 'initial' | 'incremental';
  articles: KnowledgeBaseArticleRecord[];
}

export interface ArticleChunk {
  chunk_id: string;
  heading: string;
  summary: string;
  keywords: string[];
  char_start: number;
  char_end: number;
  text_ref: string;
}

export interface ArticleIndex {
  article_id: string;
  title: string;
  summary: string;
  keywords: string[];
  chunks: ArticleChunk[];
  generated_at: string;
}

export interface AccountIndex {
  account_id: string;
  account_name: string;
  summary: string;
  topics: string[];
  tags: string[];
  timeline: Array<{
    article_id: string;
    title: string;
    publish_time: number;
  }>;
  article_refs: string[];
  generated_at: string;
}

export interface SyncResult {
  mode: 'initial' | 'incremental';
  accountId: string;
  accountName: string;
  fetchedCount: number;
  newCount: number;
  totalArticles: number;
  lastSyncedAt: string;
}

export interface UpstreamAccountSearchItem {
  fakeid: string;
  nickname: string;
  round_head_img?: string;
  alias?: string;
}

export interface UpstreamArticleItem {
  aid?: string;
  appmsgid?: string;
  itemidx?: number;
  title: string;
  digest?: string;
  create_time: number;
  link: string;
  cover?: string;
  author?: string;
}
