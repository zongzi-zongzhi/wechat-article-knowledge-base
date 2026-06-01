const assert = require('node:assert/strict');
const test = require('node:test');
const jiti = require('jiti')(__filename, { interopDefault: true });

const { shouldBuildArticleIndex } = jiti('../server/services/kb/indexer.ts');

test('shouldBuildArticleIndex rebuilds when manifest says indexed but index file is missing', () => {
  assert.equal(shouldBuildArticleIndex({ indexed: true }, false), true);
});

test('shouldBuildArticleIndex skips when manifest and index file both confirm indexed state', () => {
  assert.equal(shouldBuildArticleIndex({ indexed: true }, true), false);
});

test('shouldBuildArticleIndex builds when article has not been indexed yet', () => {
  assert.equal(shouldBuildArticleIndex({ indexed: false }, true), true);
});
