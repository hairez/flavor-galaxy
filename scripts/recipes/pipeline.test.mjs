// End-to-end test of the English recipe pipeline (RecipeNLG adapter -> IR ->
// mapper -> dedup -> RecipeDoc NDJSON) over a synthetic sample, asserting the
// output shape matches what build-seed.mjs / the index builder expect. Run:
//   node --test scripts/recipes/pipeline.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fixture = join(here, '__fixtures__', 'recipenlg-sample.csv');

test('English pipeline emits valid, deduped RecipeDocs from the sample', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'fg-corpus-'));
  const out = join(outDir, 'recipes.ndjson');
  try {
    execFileSync(
      'node',
      ['scripts/prep-recipes.mjs', '--source=recipenlg', `--in=${fixture}`, `--out=${out}`],
      { cwd: root, encoding: 'utf8' },
    );
    const docs = readFileSync(out, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

    // 5 rows: row 3 is a dup of row 0 (dropped), row 4 maps to no nodes (dropped) -> 3 emitted.
    assert.equal(docs.length, 3, `expected 3 emitted recipes, got ${docs.length}`);

    for (const d of docs) {
      assert.equal(typeof d.id, 'string');
      assert.ok(d.id.startsWith('recipenlg-'), `id should be source-prefixed: ${d.id}`);
      assert.equal(typeof d.title, 'string');
      assert.equal(typeof d.ingredients_text, 'string');
      assert.ok(Array.isArray(d.nodes) && d.nodes.length > 0, 'nodes must be non-empty');
      assert.equal(d.node_count, d.nodes.length);
      assert.deepEqual(d.nodes, [...d.nodes].sort((a, b) => a - b), 'nodes sorted');
      assert.ok(d.coverage > 0 && d.coverage <= 1, `coverage in (0,1]: ${d.coverage}`);
    }

    // The duplicate "Garlic Tomato Pasta" must appear once.
    const pasta = docs.filter((d) => d.title === 'Garlic Tomato Pasta');
    assert.equal(pasta.length, 1, 'duplicate recipe should be deduped');

    // "Mystery Dish" mapped to zero nodes and must be dropped.
    assert.ok(!docs.some((d) => d.title === 'Mystery Dish'), 'zero-node recipe should be dropped');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
