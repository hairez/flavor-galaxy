// Client for the recipe search API. Unlike the ingredient search (a synchronous
// scan of the in-memory name list), this is async/remote, so callers must handle
// loading, error, and out-of-order responses. The base URL is configured at
// build time via VITE_RECIPE_API.

import { RECIPE_POOL } from './recipePool';

// In dev with no override we default to the local server. In a production build
// with no API configured we leave the base empty so the UI disables recipe
// search rather than baking in http://localhost:8080 - which on the HTTPS Pages
// site would be a mixed-content block / connection-refused to the visitor's own
// machine. Vite inlines these at build time, so there is no runtime recovery.
const API_BASE = (
  import.meta.env.VITE_RECIPE_API ?? (import.meta.env.DEV ? 'http://localhost:8080' : '')
).replace(/\/$/, '');

// Whether recipe search has a configured backend. Callers should gate the
// recipe-search UI on this instead of issuing requests that can't succeed.
export const recipeSearchAvailable = API_BASE.length > 0;

export interface RecipeHit {
  id: string;
  title: string;
  nodeIndices: number[];
}

interface RawHit {
  id: string;
  title: string;
  nodes: number[];
}

interface RawSearch {
  hits: RawHit[];
}

export async function searchRecipes(q: string, signal?: AbortSignal): Promise<RecipeHit[]> {
  if (!recipeSearchAvailable) throw new Error('recipe search is not configured');
  const url = `${API_BASE}/api/recipes/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`recipe search failed (${res.status})`);
  const data = (await res.json()) as Partial<RawSearch>;
  // Don't trust the body's shape: a 200 with an unexpected payload must not throw
  // an opaque "undefined is not a function" inside .map.
  const hits = Array.isArray(data.hits) ? data.hits : [];
  return hits.map((h) => ({ id: h.id, title: h.title, nodeIndices: h.nodes }));
}

// A random subset of the bundled seed corpus, for the "suggested recipes" popup.
// Static and synchronous (no backend needed), so it works even when recipe search
// is unavailable. Re-draws on each call so the popup shows a fresh set every time
// it opens. Uses a partial Fisher-Yates shuffle of indices to avoid copying the
// whole pool.
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
