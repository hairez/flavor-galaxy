// A broken/missing index must surface as a rejection, never as empty results -
// the UI then shows "search unavailable" instead of a misleading "no recipes
// found" (the silent-failure guard). Separate file so the module's memoized
// manifest promise starts fresh (node:test isolates each file in its own process).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// fetch shim that fails the manifest fetch.
globalThis.fetch = async () => ({ ok: false, status: 404, async json() { return {}; }, async arrayBuffer() { return new ArrayBuffer(0); } });

const { loadRecipeIndex, queryRecipeIndex } = await import('./recipeIndex.ts');

test('a failed manifest load rejects (not empty results)', async () => {
  await assert.rejects(() => loadRecipeIndex('/whatever/'), /manifest/);
});

test('queryRecipeIndex rejects when the index never loaded', async () => {
  await assert.rejects(() => queryRecipeIndex('chicken'), /not initialized|manifest/);
});
