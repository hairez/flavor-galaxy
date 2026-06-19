// Route + backend tests driven through app.inject() (no network listen). These
// cover the query-param clamping, the in-memory scoring/pagination, the 404 vs
// error distinction, and the degraded-dependency paths the routes added.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './index.js';
import { InMemoryIndex, type SearchIndex } from './searchIndex.js';
import type { RecipeDoc } from './types.js';

const DOCS: RecipeDoc[] = [
  {
    id: 'r1',
    title: 'Tomato Basil Pasta',
    ingredients_text: 'tomato, basil, pasta, olive oil',
    nodes: [1, 2, 3],
    node_count: 3,
    coverage: 0.75,
    unmapped: ['salt'],
  },
  {
    id: 'r2',
    title: 'Garlic Butter Bread',
    ingredients_text: 'garlic, butter, bread',
    nodes: [4, 5],
    node_count: 2,
    coverage: 0.66,
    unmapped: [],
  },
  {
    id: 'r3',
    title: 'Garlic Tomato Soup',
    ingredients_text: 'garlic, tomato, stock',
    nodes: [1, 4, 6],
    node_count: 3,
    coverage: 1,
    unmapped: [],
  },
];

const memApp = () => buildApp(new InMemoryIndex(DOCS));

// A backend whose every operation throws, to exercise the error/degraded paths.
const failingIndex: SearchIndex = {
  engine: 'stub',
  search: async () => {
    throw new Error('backend down');
  },
  get: async () => {
    throw new Error('backend down');
  },
  count: async () => {
    throw new Error('backend down');
  },
};

test('search returns the documented shape and only the light-up fields', async () => {
  const app = await memApp();
  const res = await app.inject({ method: 'GET', url: '/api/recipes/search?q=tomato' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(Object.keys(body).sort(), [
    'hits',
    'limit',
    'offset',
    'query',
    'took_ms',
    'total',
  ]);
  assert.ok(body.hits.length > 0);
  const hit = body.hits[0];
  assert.deepEqual(Object.keys(hit).sort(), ['coverage', 'id', 'node_count', 'nodes', 'title']);
  assert.equal('ingredients_text' in hit, false);
  await app.close();
});

test('search scores and paginates: title hits rank first, offset/limit page', async () => {
  const app = await memApp();
  const all = (await app.inject({ url: '/api/recipes/search?q=garlic' })).json();
  assert.equal(all.total, 2); // r2 and r3 both contain "garlic"
  // Equal text score, so the coverage tiebreak ranks r3 (1.0) above r2 (0.66).
  assert.deepEqual(
    all.hits.map((h: { id: string }) => h.id),
    ['r3', 'r2'],
  );
  const paged = (await app.inject({ url: '/api/recipes/search?q=garlic&limit=1&offset=1' })).json();
  assert.equal(paged.limit, 1);
  assert.equal(paged.offset, 1);
  assert.equal(paged.total, 2);
  assert.deepEqual(
    paged.hits.map((h: { id: string }) => h.id),
    ['r2'],
  );
  await app.close();
});

test('search clamps limit/offset and tolerates NaN', async () => {
  const app = await memApp();
  const big = (await app.inject({ url: '/api/recipes/search?q=tomato&limit=999' })).json();
  assert.equal(big.limit, 50); // clamped to max 50
  const nan = (await app.inject({ url: '/api/recipes/search?q=tomato&limit=abc' })).json();
  assert.equal(nan.limit, 10); // NaN falls back to default 10
  const neg = (await app.inject({ url: '/api/recipes/search?q=tomato&offset=-5' })).json();
  assert.equal(neg.offset, 0); // clamped to >= 0
  await app.close();
});

test('empty query short-circuits to an empty result without scanning', async () => {
  const app = await memApp();
  const res = await app.inject({ url: '/api/recipes/search?q=%20%20' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.total, 0);
  assert.deepEqual(body.hits, []);
  await app.close();
});

test('search returns 502 when the backend throws', async () => {
  const app = await buildApp(failingIndex);
  const res = await app.inject({ url: '/api/recipes/search?q=tomato' });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'search_failed' });
  await app.close();
});

test('recipe lookup returns the full doc including ingredients_text and unmapped', async () => {
  const app = await memApp();
  const res = await app.inject({ url: '/api/recipes/r1' });
  assert.equal(res.statusCode, 200);
  const doc = res.json();
  assert.equal(doc.ingredients_text, 'tomato, basil, pasta, olive oil');
  assert.deepEqual(doc.unmapped, ['salt']);
  await app.close();
});

test('recipe lookup 404s for an unknown id', async () => {
  const app = await memApp();
  const res = await app.inject({ url: '/api/recipes/nope' });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.json(), { error: 'not_found' });
  await app.close();
});

test('recipe lookup returns 502 (not 404) when the backend errors', async () => {
  const app = await buildApp(failingIndex);
  const res = await app.inject({ url: '/api/recipes/r1' });
  assert.equal(res.statusCode, 502);
  assert.deepEqual(res.json(), { error: 'lookup_failed' });
  await app.close();
});

test('health reports ok with a doc count', async () => {
  const app = await memApp();
  const res = await app.inject({ url: '/api/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', engine: 'in-memory', docs: 3 });
  await app.close();
});

test('health reports degraded (503) when the dependency is unreachable', async () => {
  const app = await buildApp(failingIndex);
  const res = await app.inject({ url: '/api/health' });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.engine, 'stub');
  await app.close();
});
