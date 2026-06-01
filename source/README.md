# WeChat Article Knowledge Base

## 免责声明

本项目仅供学习交流使用。

如果本项目对任何第三方造成影响，可随时关闭本项目。

`WeChat Article Knowledge Base` is a new tool built on top of `wechat-article-exporter`.

Chinese name: `公众号知识库`

It keeps the upstream login and article fetching workflow, then adds three missing layers:
- account-level full sync
- account-level incremental sync
- AI-oriented layered indexing

The goal is not just to download articles. The goal is to turn public-account articles into a local knowledge base that can be updated on demand and read by AI with lower token cost.

## Project Positioning

This project reuses the upstream project for:
- QR-code login and credential flow
- public-account search
- article fetching and export
- local deployment and data persistence

This project adds:
- first-time full sync by account name
- incremental sync for previously synced accounts
- account-level master index
- article-level chunk index
- reindex and backfill for historical data

## Current Scope

Phase 1 focuses on the following:
- input account name and perform the first sync
- input the same account name again and trigger incremental completion manually
- build missing article indexes
- build missing account indexes
- keep a local manifest for each account
- no scheduled subscription or daily auto-sync in Phase 1

## Documents

- Product requirements: [docs/PRD.md](./docs/PRD.md)
- Technical design: [docs/TECHNICAL_DESIGN.md](./docs/TECHNICAL_DESIGN.md)
- Initial architecture notes: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Task breakdown: [docs/TODO.md](./docs/TODO.md)

## Suggested Data Layout

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

## Naming

- Product name: `WeChat Article Knowledge Base`
- Chinese name: `公众号知识库`
- Suggested GitHub repository name: `wechat-article-knowledge-base`

## GitHub Publishing

Before publishing this project:
- keep secrets in `.env`
- do not commit synced article data
- review upstream license requirements
- document setup and usage clearly
- check commit history for tokens, cookies, and private data

Basic commands:

```powershell
git init
git add .
git commit -m "docs: rename project to WeChat Article Knowledge Base"
git branch -M main
git remote add origin https://github.com/<your-name>/wechat-article-knowledge-base.git
git push -u origin main
```

## Quick Start For Users

Windows users can simply double-click:

- `start-app.bat`

This script will:
- install dependencies if needed
- build the project
- start the local server
- open `http://localhost:3000`

To stop the app, either:
- close the server window
- or double-click `stop-app.bat`
