// Builds the multi-source recipe corpus (mirroring the Epicure paper's ~4.14M
// aggregate) into server/data/recipes.ndjson, in the same RecipeDoc shape as the
// seed builder, so `npm run prep:index` consumes it unchanged.
//
// Per source: stream the adapter -> IntermediateRecipe -> map ingredient forms to
// canonical node indices -> dedup -> emit. English sources map directly via the
// shared mapper (scripts/lib/normalize.mjs). Non-English sources build a one-time
// LLM surface-form cache (scripts/recipes/surface-map/<lang>.json), then apply it.
//
// Usage:
//   node scripts/prep-recipes.mjs                     # all sources with adapters
//   node scripts/prep-recipes.mjs --source=recipenlg  # one source
//   node scripts/prep-recipes.mjs --source=recipenlg --in=/path/file.csv --limit=5000
//   node scripts/prep-recipes.mjs --no-llm            # skip non-English LLM mapping
//   node scripts/prep-recipes.mjs --out=/path/out.ndjson
//
// LICENSING: see scripts/recipes/sources.config.mjs. Acquire each source under its
// own terms; raw data and recipes.ndjson stay gitignored.

import { createWriteStream, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMapper } from './lib/normalize.mjs';
import { SOURCES, ADAPTERS } from './recipes/sources.config.mjs';
import { normalizeIR } from './recipes/ir.mjs';
import { Emitter } from './recipes/emit.mjs';
import {
  loadCache, saveCache, topFormsCovering, makeResolver,
} from './recipes/surface-map.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');

function parseArgs(argv) {
  const args = { limit: Infinity, noLlm: false };
  for (const a of argv) {
    if (a === '--no-llm') args.noLlm = true;
    else if (a.startsWith('--source=')) args.source = a.slice(9);
    else if (a.startsWith('--in=')) args.in = a.slice(5);
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a.startsWith('--limit=')) args.limit = Number(a.slice(8));
  }
  return args;
}

// A backpressure-aware line writer for the output stream.
function makeWriter(stream) {
  return (line) =>
    new Promise((resolve) => {
      if (stream.write(line)) resolve();
      else stream.once('drain', resolve);
    });
}

async function runEnglishSource(adapterGen, opts, emitter, mapper) {
  const resolve = makeResolver({ mapper });
  for await (const raw of adapterGen({ path: opts.path, limit: opts.limit })) {
    const ir = normalizeIR(raw);
    if (ir) await emitter.add(ir, resolve);
  }
}

async function runNonEnglishSource(adapterGen, opts, emitter, mapper, cfg, args) {
  let cacheTable = loadCache(cfg.lang);
  if (!Object.keys(cacheTable).length) {
    if (args.noLlm) {
      console.warn(`  [${opts.id}] no surface-map cache for "${cfg.lang}" and --no-llm set; skipping.`);
      return;
    }
    // Pass 1: count distinct surface forms.
    const freq = new Map();
    for await (const raw of adapterGen({ path: opts.path, limit: opts.limit })) {
      const ir = normalizeIR(raw);
      if (!ir) continue;
      for (const f of ir.ingredientStrings) freq.set(f, (freq.get(f) ?? 0) + 1);
    }
    const forms = topFormsCovering(freq, 0.99);
    console.log(`  [${opts.id}] translating ${forms.length} distinct forms (of ${freq.size}) via LLM...`);
    const { translateSurfaceForms } = await import('./recipes/llm-map.mjs');
    const english = await translateSurfaceForms(forms, {
      lang: cfg.lang,
      onProgress: (c) => process.stdout.write(`\r  [${opts.id}] batch: ${c.succeeded}/${c.processing + c.succeeded + c.errored} done`),
    });
    process.stdout.write('\n');
    // Resolve English -> node via the shared mapper; commit the combined table.
    cacheTable = {};
    for (const [form, eng] of Object.entries(english)) {
      const node = eng ? mapper.mapTerm(eng).node : null;
      cacheTable[form] = { english: eng, node };
    }
    saveCache(cfg.lang, cacheTable);
  }
  // Pass 2: apply the cache at scale.
  const resolve = makeResolver({ cacheTable });
  for await (const raw of adapterGen({ path: opts.path, limit: opts.limit })) {
    const ir = normalizeIR(raw);
    if (ir) await emitter.add(ir, resolve);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const meta = JSON.parse(readFileSync(join(ROOT, 'public/data/meta.json'), 'utf8'));
  const aliasFile = JSON.parse(readFileSync(join(ROOT, 'scripts/aliases.json'), 'utf8'));
  const mapper = createMapper(meta.names, aliasFile.aliases);
  if (mapper.invalidAliases.length) {
    console.warn('Ignored invalid aliases:', mapper.invalidAliases);
  }

  const outPath = args.out ?? join(ROOT, 'server', 'data', 'recipes.ndjson');
  mkdirSync(dirname(outPath), { recursive: true });
  const stream = createWriteStream(outPath, 'utf8');
  const emitter = new Emitter(makeWriter(stream));

  const selected = args.source ? [args.source] : Object.keys(SOURCES);
  for (const id of selected) {
    const cfg = SOURCES[id];
    if (!cfg) {
      console.warn(`Unknown source "${id}"; skipping.`);
      continue;
    }
    if (!cfg.adapter || !ADAPTERS[cfg.adapter]) {
      console.warn(`  [${id}] no adapter implemented yet (lang=${cfg.lang}); skipping. See sources.config.mjs.`);
      continue;
    }
    const path = args.in ?? cfg.path;
    if (!existsSync(path)) {
      console.warn(`  [${id}] data not found at ${path}; acquire it (${cfg.url || 'see source'}) or pass --in. Skipping.`);
      continue;
    }
    const adapterGen = await ADAPTERS[cfg.adapter]();
    const opts = { id, path, limit: args.limit };
    console.log(`Source [${id}] lang=${cfg.lang} ...`);
    if (cfg.lang === 'en') await runEnglishSource(adapterGen, opts, emitter, mapper);
    else await runNonEnglishSource(adapterGen, opts, emitter, mapper, cfg, args);
    const s = emitter.stats.bySource[id] ?? { seen: 0, emitted: 0 };
    console.log(`  [${id}] emitted ${s.emitted}/${s.seen}`);
  }

  await new Promise((resolve) => stream.end(resolve));

  const st = emitter.stats;
  const cov = st.totalIngredients ? ((st.totalMapped / st.totalIngredients) * 100).toFixed(1) : '0';
  console.log(`\nWrote ${st.emitted} recipes -> ${outPath}`);
  console.log(`  seen ${st.seen}, dropped ${st.droppedNoNodes} (no nodes) + ${st.droppedDup} (dup)`);
  console.log(`  ingredient mapping coverage: ${st.totalMapped}/${st.totalIngredients} (${cov}%)`);
  if (!st.emitted) {
    console.log('\nNo recipes emitted. Acquire a source dataset (see scripts/recipes/sources.config.mjs)');
    console.log('or test the pipeline on a sample: node scripts/prep-recipes.mjs --source=recipenlg --in=<sample.csv>');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
