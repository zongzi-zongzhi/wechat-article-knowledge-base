import { reindexAccount, reindexAllAccounts } from '~/server/services/kb/indexer';

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

  return reindexAccount(body.accountId);
});
