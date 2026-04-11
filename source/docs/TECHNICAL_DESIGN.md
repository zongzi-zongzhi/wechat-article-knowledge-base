# Technical Design

Project name: `WeChat Article Knowledge Base`

Chinese name: `公众号知识库`

## 1. Design Goal

Build on top of the upstream project instead of replacing it.

The upstream project should continue to handle:
- login
- credential lifecycle
- account search
- article acquisition
- export-friendly content output

This project should add:
- account-level sync orchestration
- persistent account manifests
- layered indexes for AI retrieval
- backfill tasks for historical content

## 2. Proposed Modules

### 2.1 account-sync
Responsibilities:
- search account by name through upstream capability
- resolve a stable account identifier
- run first sync
- run manually triggered incremental sync
- update local manifest

### 2.2 storage
Responsibilities:
- read and write account manifests
- read and write article metadata
- save raw article content
- save generated index files
- expose account and article lookup helpers

### 2.3 indexer
Responsibilities:
- generate account master index
- generate article chunk index
- mark indexing status

### 2.4 reindex-job
Responsibilities:
- scan local account directories
- detect missing indexes
- generate missing account and article indexes

### 2.5 api or cli entrypoints
Responsibilities:
- accept account sync requests
- accept reindex requests
- expose status and manifest information

## 3. Data Model

### 3.1 manifest.json
Suggested fields:
- `account_name`
- `account_id`
- `biz`
- `last_synced_at`
- `sync_mode`
- `article_count`
- `articles`

Each article record should include:
- `article_id`
- `title`
- `publish_time`
- `url`
- `mid`
- `idx`
- `indexed`

### 3.2 account_index.json
Suggested fields:
- `account_id`
- `account_name`
- `summary`
- `topics`
- `tags`
- `timeline`
- `article_refs`
- `generated_at`

### 3.3 article.json
Suggested fields:
- `article_id`
- `title`
- `publish_time`
- `source_url`
- `content_type`
- `content_text`
- `content_html_path`

### 3.4 article_index.json
Suggested fields:
- `article_id`
- `title`
- `summary`
- `keywords`
- `chunks`
- `generated_at`

Each chunk should include:
- `chunk_id`
- `heading`
- `summary`
- `keywords`
- `char_start`
- `char_end`
- `text_ref`

## 4. Suggested Local Layout

```text
src/
  api/
  services/
    account-sync/
    storage/
    indexer/
    reindex/
  types/
scripts/
docs/
data/
  accounts/
    <account_id>/
      manifest.json
      account_index.json
      articles/
        <article_id>/
          raw.html
          article.json
          article_index.json
```

## 5. Core Workflows

### 5.1 First Sync Workflow
1. accept account name
2. query upstream search capability
3. resolve target account and stable identifier
4. fetch article list pages
5. store article metadata and raw content
6. create or update manifest

### 5.2 Manually Triggered Incremental Completion Workflow
1. accept account name
2. locate existing manifest by account name or identifier
3. fetch latest remote article list
4. build a local known-article set
5. fetch only missing articles
6. update manifest and status`r`n7. generate indexes for newly fetched articles`r`n8. refresh account index when needed

### 5.3 Article Index Workflow
1. read local article content
2. normalize text
3. split text into chunks
4. generate summary and keywords per chunk
5. write `article_index.json`
6. update article indexed flag

### 5.4 Account Index Workflow
1. read manifest and article metadata
2. aggregate article topics and time range
3. generate account-level summary and references
4. write `account_index.json`

### 5.5 Reindex Workflow
1. scan all local accounts
2. detect missing `account_index.json`
3. detect missing `article_index.json`
4. generate missing indexes
5. update manifest and status fields

## 6. API Shape

### 6.1 Sync API
`POST /api/accounts/sync`

Request body:
- `accountName`
- `mode`: `full` or `incremental`

Response:
- `accountId`
- `fetchedCount`
- `newCount`
- `updatedAt`

### 6.2 Reindex API
`POST /api/accounts/reindex`

Request body:
- `accountId` or `all=true`

Response:
- `accountsProcessed`
- `articlesIndexed`
- `accountIndexesBuilt`

### 6.3 Status API
`GET /api/accounts/:id`

Response should include:
- manifest summary
- article count
- index status
- last sync time

## 7. Phase 1 Implementation Strategy

Recommended order:
1. inspect upstream code and locate reusable fetch pipeline
2. implement storage helpers and manifest schema
3. implement first sync orchestration
4. implement incremental sync comparison
5. implement article indexing
6. implement account indexing
7. implement reindex job
8. expose API or CLI commands with one unified sync entry: first sync when no manifest exists, incremental completion when manifest already exists

## 8. Known Risks

### 8.1 Stable account identification
Account-name search may not always map cleanly to one stable identifier. This needs verification in the upstream code.

### 8.2 Historical completeness
The project should target "maximum searchable coverage" rather than guaranteed perfect archive coverage.

### 8.3 Indexing cost
If AI-based summarization is used, indexing cost and rate limits need to be controlled. A rule-based fallback indexer may be useful for Phase 1.

## 9. Recommendation

Do not start with UI or schedulers.

Start with:
- upstream capability verification
- sync orchestration
- storage format
- indexing pipeline`r`n- manual sync orchestration instead of cron-based scheduling in Phase 1

Once those are stable, add API routes or a frontend page on top.

