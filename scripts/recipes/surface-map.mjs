// Surface-form -> canonical-node resolution, with a frequency-ranked, translate-
// once, apply-at-scale cache for non-English sources (the reconstruction of the
// Epicure paper's "LLM-augmented pipeline").
//
// English sources need no cache: their ingredient strings go straight through the
// shared mapper (scripts/lib/normalize.mjs). Non-English sources build a cache
// table (surfaceForm -> { english, node }) once via the LLM (llm-map.mjs), commit
// it under scripts/recipes/surface-map/<lang>.json, and then resolve every recipe
// by O(1) lookup with no further LLM calls.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(here, 'surface-map');

export function cachePath(lang) {
  return join(CACHE_DIR, `${lang}.json`);
}

export function loadCache(lang) {
  const p = cachePath(lang);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function saveCache(lang, table) {
  mkdirSync(CACHE_DIR, { recursive: true });
  // Sort keys for a stable, diff-friendly committed file.
  const sorted = {};
  for (const k of Object.keys(table).sort()) sorted[k] = table[k];
  writeFileSync(cachePath(lang), JSON.stringify(sorted, null, 2) + '\n');
}

// The distinct surface forms that together cover `fraction` (e.g. 0.99) of all
// occurrences, most frequent first. The long tail below the cut is left unmapped:
// it contributes negligibly to coverage and would dominate translation cost.
export function topFormsCovering(freqMap, fraction = 0.99) {
  const entries = [...freqMap.entries()].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (total === 0) return [];
  const cut = total * fraction;
  const out = [];
  let acc = 0;
  for (const [form, n] of entries) {
    out.push(form);
    acc += n;
    if (acc >= cut) break;
  }
  return out;
}

// A memoized resolver: surface form -> node index (or null). For English, pass
// only the mapper. For non-English, pass the committed cache table; forms missing
// from it resolve to null (the long tail).
export function makeResolver({ mapper, cacheTable }) {
  const memo = new Map();
  return (form) => {
    if (memo.has(form)) return memo.get(form);
    let node = null;
    if (cacheTable) {
      const hit = cacheTable[form];
      node = hit ? hit.node : null;
    } else if (mapper) {
      node = mapper.mapTerm(form).node;
    }
    memo.set(form, node);
    return node;
  };
}
