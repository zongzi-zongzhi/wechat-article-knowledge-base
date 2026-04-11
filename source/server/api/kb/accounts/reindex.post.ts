import { buildAccountIndex, buildArticleIndex, reindexAllAccounts } from '~/server/services/kb/indexer';
import { readManifest, writeManifest } from '~/server/services/kb/storage';

export default defineEventHandler(async event => {
  const body = await readBody<{ accountId?: string; all?: boolean }>(event);

  if (body.all) {
    const results = await reindexAllAccounts();
    return {
      accountsProcessed: results.length,
      results,
    };
  }

  if (!body.accountId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'accountId or all=true is required',
    });
  }

  const manifest = await readManifest(body.accountId);
  if (!manifest) {
    throw createError({
      statusCode: 404,
      statusMessage: `Manifest not found for account ${body.accountId}`,
    });
  }

  let articleIndexesBuilt = 0;
  for (const article of manifest.articles) {
    if (!article.indexed) {
      await buildArticleIndex(body.accountId, article);
      article.indexed = true;
      article.updated_at = new Date().toISOString();
      articleIndexesBuilt++;
    }
  }

  await writeManifest(body.accountId, manifest);
  await buildAccountIndex(body.accountId);

  return {
    accountId: body.accountId,
    articleIndexesBuilt,
    accountIndexBuilt: true,
  };
});
