import { syncAccountByName } from '~/server/services/kb/account-sync';

export default defineEventHandler(async event => {
  const body = await readBody<{ accountNames?: string[]; includeCover?: boolean }>(event);
  const accountNames = Array.from(
    new Set(
      (body.accountNames || [])
        .map(accountName => accountName.trim())
        .filter(Boolean)
    )
  );
  const includeCover = !!body.includeCover;

  if (!accountNames.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'accountNames is required',
    });
  }

  const results = [] as Array<
    | {
        accountName: string;
        status: 'success';
        mode: 'initial' | 'incremental';
        accountId: string;
        fetchedCount: number;
        newCount: number;
        totalArticles: number;
        lastSyncedAt: string;
      }
    | {
        accountName: string;
        status: 'failed';
        error: string;
      }
  >;

  for (const accountName of accountNames) {
    try {
      const result = await syncAccountByName(event, accountName, { includeCover });
      results.push({
        accountName,
        status: 'success',
        ...result,
      });
    } catch (error: any) {
      results.push({
        accountName,
        status: 'failed',
        error: error?.data?.statusMessage || error?.message || 'Batch sync failed',
      });
    }
  }

  return {
    total: accountNames.length,
    succeeded: results.filter(item => item.status === 'success').length,
    failed: results.filter(item => item.status === 'failed').length,
    results,
  };
});
