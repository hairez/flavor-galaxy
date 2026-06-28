// Tests the static recipe-index client against an independent reimplementation of
// the recipe ranking rule, over the real seed index. Run:
//   npm run prep:index   (build the index first)
//   node --test src/recipeIndex.test.mjs
//
// A filesystem fetch shim lets the browser-oriented client read the committed
// index files directly: it is given absolute paths (baseUrl = <root>/public/).

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

// fetch shim: treat the URL as a filesystem path.
globalThis.fetch = async (url) => {
  const buf = readFileSync(url);
  return {
    ok: true,
    status: 200,
    async json() {
      return JSON.parse(buf.toString('utf8'));
    },
    async arrayBuffer() {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
};

const { loadRecipeIndex, queryRecipeIndex } = await import('./recipeIndex.ts');

// Reference scorer: the recipe ranking rule the static index must reproduce.
const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const docs = readFileSync(join(root, 'server/data/recipes.ndjson'), 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

function refSearch(query, limit = 12) {
  const qRaw = query.trim().toLowerCase();
  const qTokens = tokenize(query);
  const scored = [];
  if (qRaw) {
    docs.forEach((doc, idx) => {
      const title = doc.title.toLowerCase();
      const ing = doc.ingredients_text.toLowerCase();
      let s = 0;
      if (title.includes(qRaw)) s += 50;
      for (const t of qTokens) {
        if (title.includes(t)) s += 6;
        if (ing.includes(t)) s += 2;
      }
      if (s === 0) return;
      scored.push({ id: doc.id, idx, s: s + doc.coverage });
    });
    // docId == corpus order == array index, so ties break by idx ascending.
    scored.sort((a, b) => b.s - a.s || a.idx - b.idx);
  }
  return scored.slice(0, limit).map((x) => x.id);
}

before(async () => {
  await loadRecipeIndex(`${root}/public/`);
});

// Queries chosen to be whole tokens / prefixes present in the seed, where the
// inverted-index client and the substring reference agree (the documented
// interior-substring deviation does not apply to these).
const QUERIES = [
  'pizza', 'chicken', 'garlic', 'tomato', 'cheese', 'rice', 'egg',
  'soup', 'salad', 'olive oil', 'basil', 'beef', 'pasta', 'choc',
];

test('client ranking matches the reference scorer for whole-token queries', async () => {
  for (const q of QUERIES) {
    const ref = refSearch(q);
    const got = (await queryRecipeIndex(q)).map((h) => h.id);
    assert.deepEqual(got, ref, `query "${q}": client ${JSON.stringify(got)} != ref ${JSON.stringify(ref)}`);
  }
});

test('hits carry the contract shape {id, title, nodeIndices}', async () => {
  const hits = await queryRecipeIndex('pizza');
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.equal(typeof h.id, 'string');
    assert.equal(typeof h.title, 'string');
    assert.ok(Array.isArray(h.nodeIndices));
    assert.ok(h.nodeIndices.every((n) => Number.isInteger(n) && n >= 0));
  }
});

test('empty and no-match queries return []', async () => {
  assert.deepEqual(await queryRecipeIndex(''), []);
  assert.deepEqual(await queryRecipeIndex('   '), []);
  assert.deepEqual(await queryRecipeIndex('zzzqqxnotathing'), []);
});

test('an already-aborted signal throws AbortError', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(() => queryRecipeIndex('chicken', ac.signal), (e) => e.name === 'AbortError');
});
