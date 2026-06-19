// The shape shared across the API. The contract that ties the whole feature
// together: every recipe carries `nodes` - the canonical ingredient indices
// (0..1789 in public/data/meta.json `names`) - so the frontend highlights stars
// with no extra lookup.

export interface RecipeDoc {
  id: string;
  title: string;
  ingredients_text: string;
  nodes: number[];
  node_count: number;
  coverage: number; // fraction of the recipe's ingredients that mapped to a node
  unmapped?: string[];
}

// The reduced shape returned by search: only the fields needed to light up the
// constellation. It is a strict subset of RecipeDoc (no ingredients_text /
// unmapped), so search payloads stay small and no consumer can read a field the
// projection never retrieved.
export interface SearchHit {
  id: string;
  title: string;
  nodes: number[];
  node_count: number;
  coverage: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  took_ms: number;
  hits: SearchHit[];
}

// Accepts any value carrying the SearchHit fields (a full RecipeDoc qualifies),
// so it works for both the in-memory full doc and the Meili search projection.
export function toHit(doc: SearchHit): SearchHit {
  return {
    id: doc.id,
    title: doc.title,
    nodes: doc.nodes,
    node_count: doc.node_count,
    coverage: doc.coverage,
  };
}
