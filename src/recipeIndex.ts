// Client for the static, server-less recipe search index built by
// scripts/build-recipe-index.mjs and served from public/data/recipe-index/.
// Recipe search runs entirely in the browser: a small manifest is fetched once,
// then only the term-postings shards a query touches and the doc-store shards
// for the top hits are fetched on demand. No backend.
//
// Ranking reproduces server/src/searchIndex.ts: per query token, +6 if it hits
// the title and +2 if it hits the ingredient text; +50 if the whole query is a
// substring of the title; coverage as the final tiebreak. One intentional
// deviation: a query token only matches indexed terms it is a *prefix* of (so
// "garl" -> "garlic"); interior substrings of a single token (e.g. "arli") are
// not matched. Whole tokens, prefix typing, multi-token queries, and the +50
// whole-query title boost all retain parity.

export interface RecipeHit {
  id: string;
  title: string;
  nodeIndices: number[];
}

interface Manifest {
  format: number;
  version: string;
  tokenizer: string;
  scoring: { titleSubstring: number; titleToken: number; ingToken: number };
  docs: { shardSize: number; count: number; shardCount: number };
  prefixes: string[];
}

const SEARCH_LIMIT = 12; // results shown in the dropdown
const TOP_K = 50; // candidates whose doc records we load before the +50/coverage re-rank

// Must match the tokenizer in the builder and server/src/searchIndex.ts.
const tokenize = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const prefixOf = (term: string): string => (term.length >= 2 ? term.slice(0, 2) : term);

let base = '';
let manifestPromise: Promise<Manifest> | null = null;
const prefixSet = new Set<string>();

// Load (once) the index manifest. Rejects on failure - callers must surface that
// as an error state, never as empty results (see src/recipes.ts).
export function loadRecipeIndex(baseUrl: string): Promise<Manifest> {
  if (!manifestPromise) {
    base = `${baseUrl}data/recipe-index/`;
    manifestPromise = fetch(`${base}manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`recipe index manifest: ${r.status}`);
        return r.json() as Promise<Manifest>;
      })
      .then((m) => {
        for (const p of m.prefixes) prefixSet.add(p);
        return m;
      });
  }
  return manifestPromise;
}

// --- binary readers ---

interface Cursor {
  buf: Uint8Array;
  pos: number;
}

function readVarint(c: Cursor): number {
  let result = 0;
  let shift = 0;
  let b: number;
  do {
    b = c.buf[c.pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return result;
}

const td = new TextDecoder();
function readString(c: Cursor, len: number): string {
  const s = td.decode(c.buf.subarray(c.pos, c.pos + len));
  c.pos += len;
  return s;
}

function u32(buf: Uint8Array, pos: number): number {
  return (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
}

// --- postings shards ---

interface TermDirEntry {
  term: string;
  off: number;
}
interface PostingsShard {
  buf: Uint8Array;
  terms: TermDirEntry[]; // sorted by term
}

const postingsCache = new Map<string, Promise<PostingsShard | null>>();

function getPostingsShard(prefix: string): Promise<PostingsShard | null> {
  if (!prefixSet.has(prefix)) return Promise.resolve(null);
  let p = postingsCache.get(prefix);
  if (!p) {
    p = fetch(`${base}postings/${prefix}.bin`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`postings shard ${prefix}: ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        const c: Cursor = { buf, pos: 4 }; // skip magic
        const termCount = u32(buf, c.pos);
        c.pos += 4;
        const terms: TermDirEntry[] = [];
        for (let i = 0; i < termCount; i++) {
          const len = readVarint(c);
          const term = readString(c, len);
          const off = u32(buf, c.pos);
          c.pos += 4;
          terms.push({ term, off });
        }
        return { buf, terms };
      });
    postingsCache.set(prefix, p);
  }
  return p;
}

// Decode one term's two delta-encoded docId lists, starting at byte offset `off`.
function readPostingEntry(shard: PostingsShard, off: number): { title: number[]; ing: number[] } {
  const c: Cursor = { buf: shard.buf, pos: off };
  const readList = (): number[] => {
    const n = readVarint(c);
    const out = new Array<number>(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
      prev += readVarint(c);
      out[i] = prev;
    }
    return out;
  };
  const title = readList();
  const ing = readList();
  return { title, ing };
}

// All directory terms that have `token` as a prefix (the sorted directory makes
// this a contiguous run). Covers exact-token and live prefix typing.
function termsWithPrefix(shard: PostingsShard, token: string): TermDirEntry[] {
  const out: TermDirEntry[] = [];
  for (const e of shard.terms) {
    if (e.term.startsWith(token)) out.push(e);
  }
  return out;
}

// --- doc-store shards ---

interface DocShard {
  buf: Uint8Array;
  recordsBase: number;
  offsets: Uint32Array;
}

const docCache = new Map<number, Promise<DocShard>>();

function getDocShard(shardId: number): Promise<DocShard> {
  let p = docCache.get(shardId);
  if (!p) {
    const name = String(shardId).padStart(4, '0');
    p = fetch(`${base}docs/${name}.bin`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`doc shard ${shardId}: ${r.status}`);
        const buf = new Uint8Array(await r.arrayBuffer());
        const count = u32(buf, 4);
        const offsets = new Uint32Array(count + 1);
        for (let i = 0; i <= count; i++) offsets[i] = u32(buf, 8 + i * 4);
        return { buf, recordsBase: 8 + (count + 1) * 4, offsets };
      });
    docCache.set(shardId, p);
  }
  return p;
}

function readDocRecord(shard: DocShard, localIndex: number): RecipeHit & { coverage: number } {
  const c: Cursor = { buf: shard.buf, pos: shard.recordsBase + shard.offsets[localIndex] };
  const coverage = readVarint(c) / 1000;
  const nodeCount = readVarint(c);
  const nodeIndices = new Array<number>(nodeCount);
  for (let i = 0; i < nodeCount; i++) {
    nodeIndices[i] = shard.buf[c.pos] | (shard.buf[c.pos + 1] << 8);
    c.pos += 2;
  }
  const idLen = readVarint(c);
  const id = readString(c, idLen);
  const titleLen = readVarint(c);
  const title = readString(c, titleLen);
  return { id, title, nodeIndices, coverage };
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

// --- query ---

export async function queryRecipeIndex(query: string, signal?: AbortSignal): Promise<RecipeHit[]> {
  if (!manifestPromise) throw new Error('recipe index not initialized');
  const m = await manifestPromise;
  aborted(signal);
  const qRaw = query.trim().toLowerCase();
  const tokens = tokenize(qRaw);
  if (!tokens.length) return [];

  // Per token: the set of docs hit in title and in ingredients (unioned over all
  // indexed terms the token is a prefix of).
  const titleSets: Set<number>[] = [];
  const ingSets: Set<number>[] = [];
  for (const t of tokens) {
    const shard = await getPostingsShard(prefixOf(t));
    aborted(signal);
    const titleSet = new Set<number>();
    const ingSet = new Set<number>();
    if (shard) {
      for (const e of termsWithPrefix(shard, t)) {
        const { title, ing } = readPostingEntry(shard, e.off);
        for (const d of title) titleSet.add(d);
        for (const d of ing) ingSet.add(d);
      }
    }
    titleSets.push(titleSet);
    ingSets.push(ingSet);
  }

  // Candidate docs = any doc hit by any token; base score per searchIndex.
  const candidates = new Map<number, number>();
  for (let i = 0; i < tokens.length; i++) {
    for (const d of titleSets[i]) candidates.set(d, (candidates.get(d) ?? 0) + m.scoring.titleToken);
    for (const d of ingSets[i]) candidates.set(d, (candidates.get(d) ?? 0) + m.scoring.ingToken);
  }
  if (!candidates.size) return [];

  // Top-K by base score, then load their doc records and apply the +50 whole-query
  // title-substring boost and the coverage tiebreak. (Any doc that could earn +50
  // has every token in its title, so it is already at/near the top by base score.)
  // Score ties break by docId ascending, matching the reference InMemoryIndex,
  // whose stable sort preserves corpus (load) order == docId order.
  const top = [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, TOP_K);

  const shardSize = m.docs.shardSize;
  const finals: { hit: RecipeHit; score: number; docId: number }[] = [];
  for (const [docId, baseScore] of top) {
    const shard = await getDocShard(Math.floor(docId / shardSize));
    aborted(signal);
    const rec = readDocRecord(shard, docId % shardSize);
    let s = baseScore;
    if (rec.title.toLowerCase().includes(qRaw)) s += m.scoring.titleSubstring;
    s += rec.coverage;
    finals.push({ hit: { id: rec.id, title: rec.title, nodeIndices: rec.nodeIndices }, score: s, docId });
  }
  finals.sort((a, b) => b.score - a.score || a.docId - b.docId);
  return finals.slice(0, SEARCH_LIMIT).map((f) => f.hit);
}
