import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { getKnowledgeBaseSettings } from '~/server/services/kb/settings';

export default defineEventHandler(async () => {
  const settings = getKnowledgeBaseSettings();
  let exists = false;

  try {
    await access(settings.rootPath, fsConstants.F_OK);
    exists = true;
  } catch {
    exists = false;
  }

  return {
    rootPath: settings.rootPath,
    exists,
  };
});
