// Client for the recipe search API. Unlike the ingredient search (a synchronous
// scan of the in-memory name list), this is async/remote, so callers must handle
// loading, error, and out-of-order responses. The base URL is configurable at
// build time via VITE_RECIPE_API and falls back to the local dev server.

const API_BASE = import.meta.env.VITE_RECIPE_API ?? 'http://localhost:8080';

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
  const url = `${API_BASE}/api/recipes/search?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`recipe search failed (${res.status})`);
  const data = (await res.json()) as RawSearch;
  return data.hits.map((h) => ({ id: h.id, title: h.title, nodeIndices: h.nodes }));
}
