// Production search backend: fronts a Meilisearch instance. Implements the same
// SearchIndex interface as the in-memory backend, so routes are agnostic. Only
// used when MEILI_HOST is set; otherwise this module is never imported.

import { MeiliSearch } from 'meilisearch';
import type { SearchIndex } from './searchIndex.js';
import type { RecipeDoc, SearchResponse } from './types.js';
import { toHit } from './types.js';
import { config } from './config.js';

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
    return {
      query,
      total: res.estimatedTotalHits ?? res.hits.length,
      limit,
      offset,
      took_ms: Math.round((performance.now() - start) * 100) / 100,
      hits: res.hits.map((h) => toHit(h as RecipeDoc)),
    };
  }

  async get(id: string): Promise<RecipeDoc | null> {
    try {
      return (await this.index().getDocument(id)) as RecipeDoc;
    } catch {
      return null;
    }
  }

  async count(): Promise<number> {
    const stats = await this.index().getStats();
    return stats.numberOfDocuments;
  }
}
