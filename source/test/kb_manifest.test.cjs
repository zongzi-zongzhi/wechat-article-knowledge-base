const assert = require('node:assert/strict');
const test = require('node:test');
const jiti = require('jiti')(__filename, { interopDefault: true });

const { mergeManifest, toArticleRecord } = jiti('../server/services/kb/manifest.ts');

test('toArticleRecord creates a stable account-scoped article id', () => {
  const article = toArticleRecord('fakeid-1', {
    aid: 'aid-1',
    appmsgid: 'msg-1',
    itemidx: 2,
    title: 'A title',
    digest: 'A digest',
    create_time: 1710000000,
    link: 'https://example.com/a',
    cover: 'https://example.com/cover.jpg',
    author: 'Author',
  });

  assert.equal(article.article_id, 'fakeid-1:aid-1');
  assert.equal(article.idx, 2);
  assert.equal(article.indexed, false);
  assert.equal(article.title, 'A title');
});

test('mergeManifest preserves local content while refreshing remote metadata', () => {
  const existing = {
    version: '1.0',
    account_name: 'Old Name',
    account_id: 'fakeid-1',
    fakeid: 'fakeid-1',
    total_articles: 1,
    last_synced_at: '2024-01-01T00:00:00.000Z',
    sync_mode: 'initial',
    articles: [
      {
        article_id: 'fakeid-1:aid-1',
        aid: 'aid-1',
        appmsgid: 'msg-1',
        idx: 1,
        title: 'Old title',
        digest: 'Old digest',
        publish_time: 1700000000,
        link: 'https://example.com/old',
        content_text: 'local text',
        raw_html_path: 'raw.html',
        markdown_path: 'article.md',
        indexed: true,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
    ],
  };

  const incoming = [
    {
      article_id: 'fakeid-1:aid-1',
      aid: 'aid-1',
      appmsgid: 'msg-1',
      idx: 1,
      title: 'New title',
      digest: 'New digest',
      publish_time: 1700000000,
      link: 'https://example.com/new',
      indexed: false,
      created_at: '2024-02-01T00:00:00.000Z',
      updated_at: '2024-02-01T00:00:00.000Z',
    },
    {
      article_id: 'fakeid-1:aid-2',
      aid: 'aid-2',
      title: 'Another title',
      publish_time: 1710000000,
      link: 'https://example.com/another',
      indexed: false,
      created_at: '2024-02-01T00:00:00.000Z',
      updated_at: '2024-02-01T00:00:00.000Z',
    },
  ];

  const result = mergeManifest(existing, { fakeid: 'fakeid-1', nickname: 'New Name' }, incoming);
  const refreshed = result.manifest.articles.find(article => article.article_id === 'fakeid-1:aid-1');

  assert.equal(result.mode, 'incremental');
  assert.equal(result.newCount, 1);
  assert.equal(result.manifest.account_name, 'New Name');
  assert.equal(result.manifest.total_articles, 2);
  assert.equal(refreshed.title, 'New title');
  assert.equal(refreshed.digest, 'New digest');
  assert.equal(refreshed.link, 'https://example.com/new');
  assert.equal(refreshed.content_text, 'local text');
  assert.equal(refreshed.raw_html_path, 'raw.html');
  assert.equal(refreshed.markdown_path, 'article.md');
  assert.equal(refreshed.indexed, true);
  assert.equal(refreshed.created_at, '2024-01-01T00:00:00.000Z');
});
