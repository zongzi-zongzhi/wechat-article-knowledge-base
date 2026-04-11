import { findAccountStorageByName } from '~/server/services/kb/storage';

export default defineEventHandler(async event => {
  const body = await readBody<{ accountName?: string }>(event);
  const accountName = body.accountName?.trim();

  if (!accountName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'accountName is required',
    });
  }

  const existingAccount = await findAccountStorageByName(accountName);

  return {
    accountName,
    exists: !!existingAccount,
    mode: existingAccount ? 'incremental' : 'initial',
    accountId: existingAccount?.accountId || null,
    storagePath: existingAccount?.accountDir || null,
    totalArticles: existingAccount?.manifest.total_articles || 0,
    lastSyncedAt: existingAccount?.manifest.last_synced_at || null,
  };
});
