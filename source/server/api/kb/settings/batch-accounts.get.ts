import { getKnowledgeBaseBatchAccounts } from '~/server/services/kb/settings';

export default defineEventHandler(() => {
  return {
    accounts: getKnowledgeBaseBatchAccounts(),
  };
});
