// Build the local seed corpus the in-memory backend serves. Reads the
// hand-authored seed recipes, resolves each ingredient term to a canonical node
// index via the shared mapping library (scripts/lib/normalize.mjs), and writes
// one RecipeDoc per line to data/recipes.ndjson. This is the tiny, zero-download
// stand-in for the full 4.14M-recipe pipeline artifact; the doc shape is
// identical, so the backend and frontend behave the same against either.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMapper } from '../../scripts/lib/normalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');
const repoRoot = join(serverRoot, '..');

const meta = JSON.parse(readFileSync(join(repoRoot, 'public/data/meta.json'), 'utf8'));
const aliasFile = JSON.parse(readFileSync(join(repoRoot, 'scripts/aliases.json'), 'utf8'));
const seed = JSON.parse(readFileSync(join(serverRoot, 'data/seed-recipes.json'), 'utf8'));

const mapper = createMapper(meta.names, aliasFile.aliases);
if (mapper.invalidAliases.length) {
  console.warn('Ignored invalid aliases (target not canonical):', mapper.invalidAliases);
}

const docs = [];
const unmappedFreq = new Map();
let totalIngredients = 0;
let totalMapped = 0;

seed.recipes.forEach((r, i) => {
  const { nodeIndices, unmapped } = mapper.mapRecipe(r.ingredients);
  totalIngredients += r.ingredients.length;
  totalMapped += nodeIndices.length;
  for (const u of unmapped) unmappedFreq.set(u, (unmappedFreq.get(u) ?? 0) + 1);
  if (nodeIndices.length === 0) return; // drop recipes that light up nothing
  docs.push({
    id: `seed-${String(i).padStart(4, '0')}`,
    title: r.title,
    ingredients_text: r.ingredients.join(', '),
    nodes: nodeIndices,
    node_count: nodeIndices.length,
    coverage:
      r.ingredients.length === 0
        ? 0
        : Math.round((nodeIndices.length / r.ingredients.length) * 1000) / 1000,
    unmapped,
  });
});

mkdirSync(join(serverRoot, 'data'), { recursive: true });
const out = join(serverRoot, 'data', 'recipes.ndjson');
writeFileSync(out, docs.map((d) => JSON.stringify(d)).join('\n') + '\n');

const top = [...unmappedFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
console.log(`Wrote ${docs.length} recipes -> ${out}`);
console.log(
  `Ingredient mapping coverage: ${totalMapped}/${totalIngredients} ` +
    `(${((totalMapped / totalIngredients) * 100).toFixed(1)}%)`,
);
if (top.length) console.log('Top unmapped terms:', top.map(([t, n]) => `${t}(${n})`).join(', '));
