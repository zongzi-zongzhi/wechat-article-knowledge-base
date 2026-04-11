import { readAccountIndex, readManifest } from '~/server/services/kb/storage';

export default defineEventHandler(async event => {
  const accountId = getRouterParam(event, 'id');

  if (!accountId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'account id is required',
    });
  }

  const manifest = await readManifest(accountId);
  if (!manifest) {
    throw createError({
      statusCode: 404,
      statusMessage: `Manifest not found for account ${accountId}`,
    });
  }

  const accountIndex = await readAccountIndex(accountId, manifest.account_name);

  return {
    accountId,
    manifest,
    indexStatus: {
      accountIndexed: !!accountIndex,
      indexedArticles: manifest.articles.filter(article => article.indexed).length,
      totalArticles: manifest.articles.length,
    },
  };
});
