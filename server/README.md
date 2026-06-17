# Flavor Galaxy recipe search API

Serves recipe search results, each carrying the canonical ingredient **node
indices** (0..1789 in `public/data/meta.json` `names`) that the galaxy frontend
highlights.

## Run it locally (no downloads, no Meilisearch)

```bash
cd server
npm install
npm run dev        # builds the seed corpus, then starts on http://localhost:8080
```

`npm run seed` resolves the hand-authored recipes in `data/seed-recipes.json` to
node indices using the shared mapper (`../scripts/lib/normalize.mjs`) and writes
`data/recipes.ndjson`, which the in-memory backend serves.

Try it:

```bash
curl 'http://localhost:8080/api/recipes/search?q=carbonara'
curl 'http://localhost:8080/api/health'
```

## Endpoints

- `GET /api/recipes/search?q=&limit=&offset=` -> `{ query, total, limit, offset, took_ms, hits: [{ id, title, nodes, node_count, coverage }] }`
- `GET /api/recipes/:id` -> full `RecipeDoc` (includes `ingredients_text`, `unmapped`)
- `GET /api/health` -> `{ status, engine, docs }`

## Production (full corpus)

Set `MEILI_HOST` (and `MEILI_KEY`) to front a Meilisearch instance instead of
the in-memory seed. Build the index from the pipeline artifact:

```bash
MEILI_HOST=http://127.0.0.1:7700 MEILI_KEY=... RECIPES_FILE=/path/recipes.ndjson \
  npm run index
```

The full 4.14M-recipe `recipes.ndjson` is produced by the offline pipeline
(`scripts/prep-recipes.mjs`) and is not committed; see the project plan.
