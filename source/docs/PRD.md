# Product Requirements Document

## 1. Project Goal

Project name: `WeChat Article Knowledge Base`

Chinese name: `公众号知识库`

Build a new tool on top of `wechat-article-exporter`.

The new tool should keep the upstream QR-code login and article-fetching workflow, then extend it into an account-level knowledge-base sync tool.

This project is designed for repeated manual sync and AI consumption, not only for one-time article export.

## 2. Upstream Reuse Strategy

The following parts should be reused directly from the upstream project:
- QR-code login flow
- credential acquisition and reuse
- public-account search
- article fetching pipeline
- existing deployment approach

The following parts are new in this project:
- account-level full sync
- account-level incremental sync
- account-level master index
- article-level chunk index
- missing-index backfill

## 3. Requirement 1: First Sync by Account Name

### User Story
As a user, I want to input a public-account name and sync that account's currently searchable historical content into local storage.

### Functional Requirements
1. The user inputs a public-account name.
2. The system uses the upstream account-search capability to locate the target account.
3. The system starts fetching the target account's article list.
4. During the first sync, the system should fetch as much searchable historical content as possible.
5. The system saves account metadata, article metadata, raw article content, and sync state locally.

### Clarification
In this project, "all content" means:

"Using the upstream login and fetching workflow to sync as much currently searchable content from the target account as possible."

Absolute completeness is not required because it may be limited by WeChat search scope, deleted content, access restrictions, and platform behavior.

## 4. Requirement 2: Manually Triggered Incremental Completion by Account Name

### User Story
As a user, when I input the same account name again, I want the system to detect already-fetched content and only fetch newly added articles.

### Functional Requirements
1. The user inputs a public-account name that may already exist locally.
2. The system checks whether a local account manifest already exists.
3. If a manifest exists, the system loads the previously fetched article list.
4. The system fetches the latest searchable article list from the upstream pipeline.
5. The system compares remote results with the local article set.
6. Existing local articles must not be re-fetched unless explicitly requested.
7. New remote articles missing from local storage must be fetched and stored.
8. The manifest must be updated after the sync finishes.
9. New articles fetched during incremental sync should be indexed automatically or marked for immediate indexing.
10. The account master index should be refreshed after incremental completion when needed.

## 5. Requirement 3: Two-Layer AI Indexing

The system should build two layers of indexes to reduce AI token consumption.

### 5.1 Account Master Index
Each synced account should have a master index file.

The account master index should contain at least:
- account name
- account identifier
- collected article count
- time range
- topic categories
- tags or keywords
- article references
- account-level summary

Purpose:
Allow AI systems to understand the structure of the account before reading specific articles.

### 5.2 Article Chunk Index
Each article should have a separate article index file.

The article index should contain at least:
- article title
- publish time
- article summary
- keywords
- chunk list
- short summary for each chunk
- reference to text position or chunk range

Purpose:
Allow AI systems to read only relevant chunks instead of full articles.

## 6. Requirement 4: Missing Index Backfill

### User Story
As a user, I want the system to scan historical content and automatically build any missing account-level or article-level indexes.

### Functional Requirements
1. The system can scan previously synced account directories.
2. The system can detect accounts missing an account master index.
3. The system can detect articles missing an article chunk index.
4. The system can generate the missing indexes without re-fetching the source article unless necessary.

## 7. Local Data Requirements

The system should persist the following kinds of data.

### 7.1 Account Data
- account name
- account identifier
- last sync time
- total article count
- sync status

### 7.2 Article Data
- article identifier
- title
- publish time
- source URL
- raw content
- index status

### 7.3 Index Data
- account master index
- article chunk index
- index generation time
- index status

Suggested layout:

```text
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

## 8. Required System Flows

The system should support at least these flows.

### 8.1 First Sync
- user inputs account name
- system searches the account
- system fetches searchable article history
- system stores local content and metadata
- system creates or updates local manifest

### 8.2 Manually Triggered Incremental Completion
- user inputs account name again
- system loads local manifest
- system fetches latest remote article list
- system compares local and remote articles
- system only fetches missing new articles
- system updates sync metadata
- system updates article and account indexes as needed

### 8.3 Index Generation
- system generates account master index
- system generates article chunk indexes

### 8.4 Index Backfill
- system scans local historical data
- system detects missing indexes
- system builds the missing indexes

## 9. Non-Goals for Phase 1

The following are not required in the first phase:
- redesigning upstream authentication
- replacing the entire upstream frontend
- building a chat UI
- guaranteeing perfect historical completeness
- requiring a vector database from day one
- building scheduled subscriptions or daily automatic sync in Phase 1

## 10. Minimum Viable Version

Phase 1 should deliver:
1. upstream login reuse
2. first sync by account name
3. incremental sync for existing accounts
4. article-level basic indexing
5. account-level basic indexing
6. historical missing-index backfill

## 11. Summary

This project is best described as:

"An account-level sync and AI-oriented layered-indexing tool built on top of `wechat-article-exporter`."
