// Production index builder: creates the Meilisearch `recipes` index, applies
// search settings + ranking rules (coverage:desc so well-mapped recipes rank
// above sparse ones), and batch-loads the pipeline's NDJSON artifact. Run once
// against the persistent Meili volume; routine deploys reuse the existing index.
//
// Usage: MEILI_HOST=... MEILI_KEY=... RECIPES_FILE=... tsx scripts/build-index.ts

import { readFileSync } from 'node:fs';
import { MeiliSearch } from 'meilisearch';
import { config } from '../src/config.js';
import type { RecipeDoc } from '../src/types.js';

if (!config.meiliHost) {
  console.error('MEILI_HOST is required to build the Meilisearch index.');
  process.exit(1);
}

const client = new MeiliSearch({ host: config.meiliHost, apiKey: config.meiliKey });
const index = client.index<RecipeDoc>(config.meiliIndex);

const docs = readFileSync(config.recipesFile, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as RecipeDoc);

await index.updateSettings({
  searchableAttributes: ['title', 'ingredients_text'],
  // Display the full RecipeDoc so GET /api/recipes/:id returns the same shape as
  // the in-memory backend. Search still trims to the light-up fields via the
  // query's attributesToRetrieve, so search payloads stay small.
  displayedAttributes: ['id', 'title', 'ingredients_text', 'nodes', 'node_count', 'coverage', 'unmapped'],
  filterableAttributes: ['node_count', 'coverage'],
  sortableAttributes: ['coverage', 'node_count'],
  rankingRules: ['words', 'typo', 'proximity', 'attribute', 'coverage:desc', 'exactness'],
});

const BATCH = 50_000;
for (let i = 0; i < docs.length; i += BATCH) {
  const task = await index.addDocuments(docs.slice(i, i + BATCH), { primaryKey: 'id' });
  console.log(`enqueued ${Math.min(i + BATCH, docs.length)}/${docs.length} (task ${task.taskUid})`);
}
console.log('Indexing enqueued. Meilisearch will finish asynchronously.');
