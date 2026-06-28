// Client for recipe search. Recipe search runs entirely in the browser against a
// static index shipped with the site (src/recipeIndex.ts), so there is no backend
// and no external API. Callers still get an async, AbortSignal-aware interface
// because the index is fetched on demand (manifest + the shards a query touches).

import { RECIPE_POOL } from './recipePool';
import { loadRecipeIndex, queryRecipeIndex, type RecipeHit } from './recipeIndex';

export type { RecipeHit };

// Start fetching the manifest as soon as the module loads (mirrors images.ts),
// so the first query is fast. The no-op catch only silences an unhandled
// rejection on this kick-off chain; searchRecipes re-awaits the same memoized
// promise and rethrows the failure there.
void loadRecipeIndex(import.meta.env.BASE_URL).catch(() => {});

// Throws (never returns []) if the static index can't load, so a broken index
// surfaces in the UI as "search unavailable" rather than a misleading "no recipes
// found". An empty array means a genuinely empty result set.
export async function searchRecipes(q: string, signal?: AbortSignal): Promise<RecipeHit[]> {
  await loadRecipeIndex(import.meta.env.BASE_URL); // throws if the index can't load
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!q.trim()) return [];
  return queryRecipeIndex(q, signal);
}

// A random subset of the bundled seed corpus, for the "suggested recipes" popup.
// Static and synchronous (no backend, no index fetch needed), so it works
// instantly on focus even before the search index has loaded. Re-draws on each
// call so the popup shows a fresh set every time it opens. Uses a partial
// Fisher-Yates shuffle of indices to avoid copying the whole pool.
export function sampleRecipes(n: number): RecipeHit[] {
  const pool = RECIPE_POOL;
  const count = Math.max(0, Math.min(n, pool.length));
  const idx = pool.map((_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (pool.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, count).map((i) => {
    const r = pool[i];
    return { id: r.id, title: r.title, nodeIndices: r.nodes };
  });
}
