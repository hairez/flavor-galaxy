# Flavor Galaxy recipe corpus

The recipe corpus and the builder that maps each recipe's ingredients to the
canonical **node indices** (0..1789 in `public/data/meta.json` `names`) that the
galaxy frontend highlights.

There is no server. Recipe search runs entirely in the browser against a static
index built from this corpus by `scripts/build-recipe-index.mjs` (repo root) and
served from `public/data/recipe-index/`.

## Build the seed corpus (no downloads)

```bash
cd server
npm run seed       # maps data/seed-recipes.json -> data/recipes.ndjson
```

`npm run seed` resolves the hand-authored recipes in `data/seed-recipes.json` to
node indices using the shared mapper (`../scripts/lib/normalize.mjs`) and writes
one `RecipeDoc` per line to `data/recipes.ndjson` (gitignored). From the repo
root, `npm run prep:index` then turns that NDJSON into the committed search index.

## RecipeDoc shape

One JSON object per line in `data/recipes.ndjson`:

```
{ id, title, ingredients_text, nodes: number[], node_count, coverage, unmapped }
```

`nodes` are the canonical ingredient indices; `coverage` is the fraction of the
recipe's ingredient terms that mapped. The index builder reads `title`, `nodes`,
and `coverage` (plus tokenizes `ingredients_text` for matching).

## Full corpus

The full multi-source corpus (mirroring the Epicure paper's ~4.14M recipes) is
produced by the offline pipeline at `scripts/prep-recipes.mjs` (repo root) and
emitted to `data/recipes.ndjson`, the same shape as the seed, so `prep:index`
consumes either unchanged. The raw downloads and assembled corpus are large and
gitignored; only the derived search index is committed.
