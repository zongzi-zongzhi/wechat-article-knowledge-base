import { setKnowledgeBaseBatchAccounts } from '~/server/services/kb/settings';

export default defineEventHandler(async event => {
  const body = await readBody<{ accounts?: string[] }>(event);

  return {
    accounts: setKnowledgeBaseBatchAccounts(body.accounts || []),
  };
});
