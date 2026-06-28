// The 11 third-party recipe corpora behind the Epicure paper's ~4.14M aggregate,
// with the metadata the pipeline needs. Only RecipeNLG ships a working adapter
// here (it dominates at ~54% and its NER tags need no LLM); the rest are declared
// with their language, license, and download pointer so a small per-source
// adapter can be added when that dataset is in hand.
//
// LICENSING: none of these corpora are redistributable as-is. Acquire each under
// its own terms. Raw downloads and the assembled recipes.ndjson stay gitignored;
// only the derived search index ships. (User accepted this for a personal demo.)
//
// `adapter`: the async-generator name in ./adapters that yields IntermediateRecipe.
// `path`: where the orchestrator expects the downloaded file (override with --in).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, '..', '.cache', 'recipes', 'raw');

export const SOURCES = {
  recipenlg: {
    lang: 'en',
    adapter: 'recipenlg',
    share: 0.539,
    path: join(RAW, 'recipenlg', 'full_dataset.csv'),
    license: 'Non-commercial research only (Poznan University of Technology).',
    url: 'https://recipenlg.cs.put.poznan.pl/dataset',
    note: 'Uses the pre-extracted NER ingredient tags; no LLM needed.',
  },
  xiachufang: {
    lang: 'zh',
    adapter: null, // TODO: parse XiaChuFang JSON; non-English -> LLM surface-form cache
    share: 0.374,
    path: join(RAW, 'xiachufang'),
    license: 'Academic/research; redistribution unclear.',
    url: 'https://opendatalab.com/OpenDataLab/XiaChuFang_Recipe_Corpus',
  },
  povarenok: {
    lang: 'ru',
    adapter: null,
    share: 0.035,
    path: join(RAW, 'povarenok'),
    license: 'Kaggle/HF dataset terms.',
    url: 'https://huggingface.co/datasets/rogozinushka/povarenok-recipes',
  },
  vietnamese: { lang: 'vi', adapter: null, path: join(RAW, 'vietnamese'), license: 'see source', url: '' },
  spanish_recetas: { lang: 'es', adapter: null, path: join(RAW, 'spanish-recetas'), license: 'see source', url: '' },
  spanish_frorozco: { lang: 'es', adapter: null, path: join(RAW, 'spanish-frorozco'), license: 'see source', url: '' },
  spanish_abuela: { lang: 'es', adapter: null, path: join(RAW, 'spanish-abuela'), license: 'see source', url: '' },
  turkish: { lang: 'tr', adapter: null, path: join(RAW, 'turkish'), license: 'see source', url: '' },
  indian_recipes: { lang: 'en', adapter: null, path: join(RAW, 'indian-recipes'), license: 'see source', url: '' },
  indian_food_101: { lang: 'en', adapter: null, path: join(RAW, 'indian-food-101'), license: 'see source', url: '' },
  german: { lang: 'de', adapter: null, path: join(RAW, 'german'), license: 'see source', url: '' },
};

export const ADAPTERS = {
  recipenlg: () => import('./adapters/recipenlg.mjs').then((m) => m.recipenlg),
};
