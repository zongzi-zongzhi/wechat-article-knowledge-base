# Architecture

## Modules

### account-sync
Responsible for full sync and incremental sync by account name.

### storage
Responsible for reading and writing manifests, article metadata, and raw content.

### indexer
Responsible for:
- account-level master index generation
- article-level chunk index generation

### reindex-job
Responsible for scanning historical content and creating any missing indexes.

## Data Model

### manifest.json

Suggested fields:
- `account_name`
- `account_id`
- `biz`
- `last_synced_at`
- `article_count`
- `articles`

Each article item should include:
- `article_id`
- `title`
- `publish_time`
- `url`
- `mid`
- `idx`
- `indexed`

### account_index.json

Suggested fields:
- `account_id`
- `account_name`
- `summary`
- `topics`
- `tags`
- `timeline`
- `article_refs`
- `generated_at`

### article_index.json

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
