# Flavor Galaxy

An interactive map of **1,790 cooking ingredients**, learned from **4 million recipes**.
Explore how flavor is shaped by *chemistry* versus how cooks actually *combine* things.

**Live:** https://hairez.github.io/flavor-galaxy/

It visualizes the [Epicure](https://arxiv.org/abs/2605.22391) ingredient embeddings
(Radzikowski & Chen). Epicure ships three sibling models that sit at different points on a
recipe-context to chemistry spectrum:

- **Co-occurrence** - similarity from what ingredients appear together in recipes
- **Core** - a balanced blend
- **Chemistry** - similarity from shared flavor compounds (FlavorDB)

## What you can do

- **Search any ingredient** and see its nearest neighbors (cosine similarity) under each model.
- **Switch models** and watch the whole cloud re-form - the same ingredient sits in a
  different neighborhood depending on whether you weight chemistry or culinary context.
- **Color the galaxy** by food group, aroma family, or basic taste.

### Reading the map

Positions come from a 2-D [UMAP](https://umap-learn.readthedocs.io/) projection of the
300-dimensional embeddings. **Distance is the meaning** - nearby points are similar
ingredients - but the axes themselves carry no fixed units, and each model has its own layout.

## How it works

Everything runs in the browser, with no backend:

1. `scripts/prep-data.mjs` (run once, output committed) downloads the three models from
   Hugging Face, parses the `safetensors` embeddings, L2-normalizes them, derives categorical
   labels from the models' "mode" poles, and precomputes a UMAP layout per model. It writes
   two assets to `public/data/`: `vectors.bin` (the normalized vectors) and `meta.json`
   (names, layouts, labels, legends).
2. The app loads those assets and computes nearest neighbors live as dot products on the
   normalized vectors. The galaxy is rendered with [deck.gl](https://deck.gl/).

Food group is a weak signal in this data (there is no meat/seafood category), so ingredients
whose top two groups are too close are shown as a neutral grey **"Other"** rather than given a
misleading label.

## Develop

```bash
npm install
npm run dev      # local dev server
npm run build    # type-check + production build to dist/
npm run prep     # regenerate public/data from Hugging Face (rarely needed)
```

Deploys to GitHub Pages automatically on push to `main` via `.github/workflows/deploy.yml`.

## Attribution & license

- **Embeddings & ingredient data:** [Epicure](https://arxiv.org/abs/2605.22391) by Jakub
  Radzikowski and Josef Chen, published on Hugging Face
  ([epicure-cooc](https://huggingface.co/Kaikaku/epicure-cooc),
  [epicure-core](https://huggingface.co/Kaikaku/epicure-core),
  [epicure-chem](https://huggingface.co/Kaikaku/epicure-chem)), licensed **CC BY 4.0**. The
  files under `public/data/` are derived from these models and remain under CC BY 4.0.
- **Application code:** MIT (see [LICENSE](LICENSE)).
