# Changelog

## 2026-06-03

- Improved incremental account sync for large local knowledge bases.
- Added Windows-safe article file naming: `YYYY-MM-DD HH-mm - title`.
- Kept full-library indexes and moved per-article indexes into `_article_index/`.
- Limited content fetching to articles discovered in the current sync run, avoiding expensive backfills of old manifest entries during routine incremental syncs.
- Excluded local data, credentials, logs, build output, dependencies, and raw sample captures from the public GitHub package.
