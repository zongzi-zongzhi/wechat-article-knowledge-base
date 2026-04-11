import { syncAccountByName } from '~/server/services/kb/account-sync';

export default defineEventHandler(async event => {
  const body = await readBody<{ accountName?: string; includeCover?: boolean }>(event);
  const accountName = body.accountName?.trim();

  if (!accountName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'accountName is required',
    });
  }

  return syncAccountByName(event, accountName, {
    includeCover: !!body.includeCover,
  });
});
