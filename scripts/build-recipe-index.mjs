// Builds the static, server-less recipe search index from the RecipeDoc NDJSON
// corpus (server/data/recipes.ndjson) into public/data/recipe-index/. The index
// is queried entirely in the browser (src/recipeIndex.ts) via on-demand fetches,
// so recipe search needs no backend. Output is committed (or shipped via LFS for
// a large corpus); CI does not run this. Run with: npm run prep:index
//
// Layout produced under public/data/recipe-index/:
//   manifest.json          - tiny: scoring constants, doc-shard sizing, prefixes
//   docs/NNNN.bin          - doc-store, sharded by docId range (title + nodes +
//                            coverage); omits ingredients_text (matched, not shown)
//   postings/<prefix>.bin  - term postings keyed by 2-char prefix, binary-search
//                            directory + two delta-varint docId lists per term
//                            (title hits and ingredient hits, scored +6 / +2)
//
// The on-disk scoring (title substring +50, title token +6, ingredient token +2,
// coverage tiebreak) is the recipe ranking rule, reproduced by the browser client
// (src/recipeIndex.ts) and pinned by src/recipeIndex.test.mjs.

import {
  readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, createReadStream,
  readdirSync, statSync,
} from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const INPUT = process.env.RECIPES_FILE ?? join(ROOT, 'server', 'data', 'recipes.ndjson');
const OUT = join(ROOT, 'public', 'data', 'recipe-index');

const DOCS_PER_SHARD = 65536; // docId >> 16 -> shard, docId & 0xffff -> offset
const SHARD_HARD_LIMIT = 90 * 1024 * 1024; // stay under GitHub's 100MB/file wall
const SCORING = { titleSubstring: 50, titleToken: 6, ingToken: 2 };

// Must stay byte-identical to the tokenizer in the client (src/recipeIndex.ts):
// lowercase, split on non-alphanumeric, drop empties.
const tokenize = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const prefixOf = (term) => (term.length >= 2 ? term.slice(0, 2) : term);

// Unsigned LEB128 varint into a number[] byte sink.
function pushVarint(bytes, value) {
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
}
function pushU32(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}
function pushU16(bytes, value) {
  bytes.push(value & 0xff, (value >>> 8) & 0xff);
}
function pushBytes(bytes, buf) {
  for (let i = 0; i < buf.length; i++) bytes.push(buf[i]);
}

async function* readNdjson(path) {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t) yield JSON.parse(t);
  }
}

async function main() {
  if (!existsSync(INPUT)) {
    throw new Error(
      `Recipe corpus not found at ${INPUT}. Run \`npm run seed\` (server/) for the seed corpus, ` +
        `or the recipe pipeline for the full corpus, first.`,
    );
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'docs'), { recursive: true });
  mkdirSync(join(OUT, 'postings'), { recursive: true });

  const enc = new TextEncoder();
  // postings[term] = { title: number[] docIds asc, ing: number[] docIds asc }
  const postings = new Map();
  // Per open doc shard: array of per-record byte arrays.
  let shardRecords = [];
  let currentShard = 0;
  let docId = 0;
  let shardCount = 0;

  function flushDocShard(shardIndex, records) {
    if (!records.length) return;
    const head = [];
    pushU32(head, 0x46474453); // 'FGDS'
    pushU32(head, records.length);
    // offset table: (count+1) u32, offsets relative to records region
    let acc = 0;
    const offsets = [];
    for (const r of records) {
      offsets.push(acc);
      acc += r.length;
    }
    offsets.push(acc);
    for (const o of offsets) pushU32(head, o);
    const body = [];
    for (const r of records) pushBytes(body, r);
    const buf = Buffer.from(Uint8Array.from(head.concat(body)));
    const name = String(shardIndex).padStart(4, '0') + '.bin';
    writeFileSync(join(OUT, 'docs', name), buf);
    shardCount = Math.max(shardCount, shardIndex + 1);
  }

  for await (const doc of readNdjson(INPUT)) {
    const shardIndex = docId >> 16;
    if (shardIndex !== currentShard) {
      flushDocShard(currentShard, shardRecords);
      shardRecords = [];
      currentShard = shardIndex;
    }

    // Doc-store record: coverage, nodes (u16), id, title.
    const rec = [];
    pushVarint(rec, Math.round((doc.coverage ?? 0) * 1000));
    const nodes = doc.nodes ?? [];
    pushVarint(rec, nodes.length);
    for (const n of nodes) pushU16(rec, n);
    const idBytes = enc.encode(doc.id ?? `recipe-${docId}`);
    pushVarint(rec, idBytes.length);
    pushBytes(rec, idBytes);
    const titleBytes = enc.encode(doc.title ?? '');
    pushVarint(rec, titleBytes.length);
    pushBytes(rec, titleBytes);
    shardRecords.push(rec);

    // Postings: a doc is in a term's title list if the token is in the title, and
    // independently in the ing list if it is in ingredients_text. A doc can be in
    // both (token in title AND ingredients) -> +6 and +2, matching searchIndex.
    const titleTokens = new Set(tokenize(doc.title ?? ''));
    const ingTokens = new Set(tokenize(doc.ingredients_text ?? ''));
    for (const t of titleTokens) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = { title: [], ing: [] }));
      p.title.push(docId);
    }
    for (const t of ingTokens) {
      let p = postings.get(t);
      if (!p) postings.set(t, (p = { title: [], ing: [] }));
      p.ing.push(docId);
    }

    docId++;
  }
  flushDocShard(currentShard, shardRecords);
  const docCount = docId;

  // Group terms by prefix; write one postings shard per prefix.
  const byPrefix = new Map();
  for (const term of postings.keys()) {
    const p = prefixOf(term);
    if (!byPrefix.has(p)) byPrefix.set(p, []);
    byPrefix.get(p).push(term);
  }
  const prefixes = [...byPrefix.keys()].sort();

  function encodeDeltaList(bytes, docIds) {
    pushVarint(bytes, docIds.length);
    let prev = 0;
    for (const d of docIds) {
      pushVarint(bytes, d - prev); // ascending by construction -> non-negative gaps
      prev = d;
    }
  }

  for (const prefix of prefixes) {
    const terms = byPrefix.get(prefix).sort(); // sorted for binary search + prefix scan
    // First lay out entries to learn their absolute offsets, then the directory.
    const entryBytes = [];
    const entryOffsets = []; // parallel to terms
    // Directory size must be known to offset entries; compute it first.
    const dirBytes = [];
    pushU32(dirBytes, 0x46475053); // 'FGPS'
    pushU32(dirBytes, terms.length);
    // Reserve directory: varint(termLen) + term + u32(offset) per term. We need
    // offsets before writing the directory, so build entries first (offsets are
    // relative to file start = dir length + per-entry running offset).
    // Compute directory length deterministically:
    let dirLen = 8;
    for (const term of terms) {
      const tb = enc.encode(term);
      const lenField = [];
      pushVarint(lenField, tb.length);
      dirLen += lenField.length + tb.length + 4; // +4 for u32 offset
    }
    let running = dirLen;
    for (const term of terms) {
      entryOffsets.push(running);
      const p = postings.get(term);
      const e = [];
      encodeDeltaList(e, p.title);
      encodeDeltaList(e, p.ing);
      pushBytes(entryBytes, e);
      running += e.length;
    }
    for (let i = 0; i < terms.length; i++) {
      const tb = enc.encode(terms[i]);
      pushVarint(dirBytes, tb.length);
      pushBytes(dirBytes, tb);
      pushU32(dirBytes, entryOffsets[i]);
    }
    const buf = Buffer.from(Uint8Array.from(dirBytes.concat(entryBytes)));
    if (buf.length > SHARD_HARD_LIMIT) {
      throw new Error(
        `postings shard "${prefix}" is ${(buf.length / 1e6).toFixed(1)}MB, over the ` +
          `${SHARD_HARD_LIMIT / 1e6}MB cap. Prefix-shard splitting is needed for this corpus ` +
          `size (see plan: postings split table).`,
      );
    }
    writeFileSync(join(OUT, 'postings', `${prefix}.bin`), buf);
  }

  const hash = createHash('sha1').update(readFileSync(INPUT)).digest('hex').slice(0, 8);
  const manifest = {
    format: 1,
    version: `${docCount}-${hash}`,
    tokenizer: 'lower-alnum-split',
    scoring: SCORING,
    docs: { shardSize: DOCS_PER_SHARD, count: docCount, shardCount },
    prefixes,
  };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));

  // Footprint report (the plan's scale check).
  let total = 0;
  let largest = 0;
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const fp = join(dir, f.name);
      if (f.isDirectory()) walk(fp);
      else {
        const sz = statSync(fp).size;
        total += sz;
        largest = Math.max(largest, sz);
      }
    }
  };
  walk(OUT);
  console.log(`Wrote recipe index: ${docCount} recipes, ${prefixes.length} prefix shards, ${shardCount} doc shards`);
  console.log(`  total ${(total / 1e6).toFixed(2)}MB, largest file ${(largest / 1e6).toFixed(2)}MB -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
