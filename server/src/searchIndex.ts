// Pluggable search backend. The in-memory implementation (default) loads the
// seed/pipeline NDJSON artifact and runs a simple relevance scan - fine for the
// local seed corpus. Production swaps in the Meilisearch backend (meili.ts),
// which shares this interface, so routes never know which is active.

import { readFileSync, existsSync } from 'node:fs';
import type { RecipeDoc, SearchResponse } from './types.js';
import { toHit } from './types.js';

export interface SearchIndex {
  search(query: string, limit: number, offset: number): Promise<SearchResponse>;
  get(id: string): Promise<RecipeDoc | null>;
  count(): Promise<number>;
  readonly engine: string;
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export class InMemoryIndex implements SearchIndex {
  readonly engine = 'in-memory';
  private readonly docs: RecipeDoc[];
  private readonly byId: Map<string, RecipeDoc>;

  constructor(docs: RecipeDoc[]) {
    this.docs = docs;
    this.byId = new Map(docs.map((d) => [d.id, d]));
  }

  static fromNdjsonFile(path: string): InMemoryIndex {
    if (!existsSync(path)) {
      throw new Error(
        `Recipe artifact not found at ${path}. Run \`npm run seed\` (server/) to build the seed corpus first.`,
      );
    }
    const docs = readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as RecipeDoc);
    return new InMemoryIndex(docs);
  }

  // Score on title and ingredient text. Token hits in the title count double;
  // a whole-query substring in the title is a strong boost. Ties break on
  // coverage so recipes that light up a fuller constellation rank first.
  private score(doc: RecipeDoc, qTokens: string[], qRaw: string): number {
    const title = doc.title.toLowerCase();
    const ing = doc.ingredients_text.toLowerCase();
    let s = 0;
    if (title.includes(qRaw)) s += 50;
    for (const t of qTokens) {
      if (title.includes(t)) s += 6;
      if (ing.includes(t)) s += 2;
    }
    if (s === 0) return 0;
    return s + doc.coverage; // coverage as sub-unit tiebreak
  }

  async search(query: string, limit: number, offset: number): Promise<SearchResponse> {
    const start = performance.now();
    const qRaw = query.trim().toLowerCase();
    const qTokens = tokenize(query);
    const scored: { doc: RecipeDoc; s: number }[] = [];
    if (qRaw) {
      for (const doc of this.docs) {
        const s = this.score(doc, qTokens, qRaw);
        if (s > 0) scored.push({ doc, s });
      }
      scored.sort((a, b) => b.s - a.s);
    }
    const page = scored.slice(offset, offset + limit).map((x) => toHit(x.doc));
    return {
      query,
      total: scored.length,
      limit,
      offset,
      took_ms: Math.round((performance.now() - start) * 100) / 100,
      hits: page,
    };
  }

  async get(id: string): Promise<RecipeDoc | null> {
    return this.byId.get(id) ?? null;
  }

  async count(): Promise<number> {
    return this.docs.length;
  }
}
