// Production search backend: fronts a Meilisearch instance. Implements the same
// SearchIndex interface as the in-memory backend, so routes are agnostic. Only
// used when MEILI_HOST is set; otherwise this module is never imported.

import { MeiliSearch } from 'meilisearch';
import type { SearchIndex } from './searchIndex.js';
import type { RecipeDoc, SearchHit, SearchResponse } from './types.js';
import { toHit } from './types.js';
import { config } from './config.js';

// A genuine "no such document" (Meili code `document_not_found` / HTTP 404) is
// the only failure we translate to a null lookup. Connection errors, auth
// failures, timeouts and 5xx must surface so the route returns 502 instead of
// masquerading as "recipe does not exist".
function isDocumentNotFound(err: unknown): boolean {
  const e = err as { code?: string; httpStatus?: number } | null;
  return e?.code === 'document_not_found' || e?.httpStatus === 404;
}

export class MeiliIndex implements SearchIndex {
  readonly engine = 'meilisearch';
  private readonly client: MeiliSearch;

  constructor() {
    this.client = new MeiliSearch({ host: config.meiliHost!, apiKey: config.meiliKey });
  }

  private index() {
    return this.client.index<RecipeDoc>(config.meiliIndex);
  }

  async search(query: string, limit: number, offset: number): Promise<SearchResponse> {
    const start = performance.now();
    const res = await this.index().search(query, {
      limit,
      offset,
      attributesToRetrieve: ['id', 'title', 'nodes', 'node_count', 'coverage'],
    });
    // The query retrieves exactly the SearchHit fields, so type the projection as
    // SearchHit rather than asserting a full RecipeDoc we did not fetch.
    return {
      query,
      total: res.estimatedTotalHits ?? res.hits.length,
      limit,
      offset,
      took_ms: Math.round((performance.now() - start) * 100) / 100,
      hits: res.hits.map((h) => toHit(h as SearchHit)),
    };
  }

  async get(id: string): Promise<RecipeDoc | null> {
    try {
      return (await this.index().getDocument(id)) as RecipeDoc;
    } catch (err) {
      if (isDocumentNotFound(err)) return null;
      throw err;
    }
  }

  async count(): Promise<number> {
    const stats = await this.index().getStats();
    return stats.numberOfDocuments;
  }
}
