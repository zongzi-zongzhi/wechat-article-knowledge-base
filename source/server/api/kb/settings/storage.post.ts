import { mkdir } from 'node:fs/promises';
import { setKnowledgeBaseRoot } from '~/server/services/kb/settings';

export default defineEventHandler(async event => {
  const body = await readBody<{ rootPath?: string }>(event);
  const rootPath = body.rootPath?.trim();

  if (!rootPath) {
    throw createError({
      statusCode: 400,
      statusMessage: 'rootPath is required',
    });
  }

  const normalizedRootPath = setKnowledgeBaseRoot(rootPath);
  await mkdir(normalizedRootPath, { recursive: true });

  return {
    rootPath: normalizedRootPath,
  };
});
