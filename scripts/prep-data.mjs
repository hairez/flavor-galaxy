// One-time data builder for Flavor Galaxy.
//
// Downloads the three Epicure sibling models (CC BY 4.0) from Hugging Face,
// parses the safetensors embeddings, L2-normalizes them, aligns all three to a
// single canonical ingredient order, derives categorical labels from the `core`
// model's mode poles, computes a 2D UMAP layout per model, and writes compact
// assets to public/data/ (vectors.bin + meta.json).
//
// Run with:  npm run prep
// Output is committed; CI does NOT run this.

import { writeFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UMAP } from 'umap-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache');
const OUT = join(ROOT, 'public', 'data');

// Order is meaningful: cooc -> core -> chem is the recipe-context -> chemistry spectrum.
const MODELS = ['cooc', 'core', 'chem'];
const LABEL_MODEL = 'core'; // labels derived from the balanced model, fixed across layouts

const titlecase = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Categorical coloring dimensions, derived from the mode `property` prefixes.
// Each ingredient is assigned to the family whose closest mode-pole it scores highest on.
const COLOR_DIMS = {
  food_group: {
    label: 'Food group',
    select: (m) => m.property.startsWith('fg_'),
    family: (m) => m.property.slice(3),
    // No meat/seafood group exists, so proteins sit ~equidistant from several
    // groups. When the top two groups are within this cosine margin, the item
    // is too ambiguous to label and goes to "Other". Proteins (chicken/beef
    // margins ~0.03) need a threshold this high to be caught.
    otherMargin: 0.035,
  },
  aroma: {
    label: 'Aroma',
    select: (m) => m.property.startsWith('cf_'),
    family: (m) => titlecase(m.property.slice(3)),
  },
  taste: {
    label: 'Basic taste',
    select: (m) => m.property.endsWith('_score'),
    family: (m) => titlecase(m.property.replace('_score', '')),
  },
};

function hfUrl(model, file) {
  return `https://huggingface.co/Kaikaku/epicure-${model}/resolve/main/${file}`;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchCached(model, file) {
  const cacheDir = join(CACHE, model);
  const cachePath = join(cacheDir, file);
  if (await exists(cachePath)) {
    return new Uint8Array(await readFile(cachePath));
  }
  const url = hfUrl(model, file);
  process.stdout.write(`  downloading ${model}/${file} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status} ${res.statusText}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, bytes);
  console.log(`${(bytes.length / 1e6).toFixed(2)} MB`);
  return bytes;
}

// safetensors layout: [u64 header length][JSON header][raw tensor bytes]
function parseSafetensors(bytes, tensorName = 'embeddings') {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = Number(dv.getBigUint64(0, true));
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + headerLen)));
  const t = header[tensorName];
  if (!t) throw new Error(`tensor "${tensorName}" not found; keys: ${Object.keys(header)}`);
  if (t.dtype !== 'F32') throw new Error(`expected F32, got ${t.dtype}`);
  const [rows, cols] = t.shape;
  const [start, end] = t.data_offsets;
  const dataBase = 8 + headerLen;
  // Copy into a fresh buffer so the Float32Array is 4-byte aligned.
  const slice = bytes.subarray(dataBase + start, dataBase + end);
  const copy = new Uint8Array(slice.length);
  copy.set(slice);
  const flat = new Float32Array(copy.buffer, 0, rows * cols);
  return { rows, cols, flat };
}

function l2normalizeRows(flat, rows, cols) {
  for (let r = 0; r < rows; r++) {
    const o = r * cols;
    let s = 0;
    for (let c = 0; c < cols; c++) s += flat[o + c] * flat[o + c];
    const inv = 1 / Math.max(Math.sqrt(s), 1e-9);
    for (let c = 0; c < cols; c++) flat[o + c] *= inv;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dot(flat, row, cols, vec) {
  const o = row * cols;
  let s = 0;
  for (let c = 0; c < cols; c++) s += flat[o + c] * vec[c];
  return s;
}

async function main() {
  console.log('Flavor Galaxy data prep\n');

  // 1. Load all models.
  const loaded = {};
  for (const model of MODELS) {
    console.log(`[${model}]`);
    const stBytes = await fetchCached(model, 'embeddings.safetensors');
    const vocab = JSON.parse(new TextDecoder().decode(await fetchCached(model, 'vocab.json')));
    const modes = JSON.parse(new TextDecoder().decode(await fetchCached(model, 'modes.json')));
    const { rows, cols, flat } = parseSafetensors(stBytes);
    if (rows !== Object.keys(vocab).length) {
      throw new Error(`${model}: rows ${rows} != vocab size ${Object.keys(vocab).length}`);
    }
    l2normalizeRows(flat, rows, cols);
    loaded[model] = { vocab, modes, rows, cols, flat };
    console.log(`  parsed ${rows} x ${cols}, ${modes.length} modes\n`);
  }

  // 2. Canonical ingredient order (sorted names common to all models).
  const dims = loaded[MODELS[0]].cols;
  const nameSets = MODELS.map((m) => new Set(Object.keys(loaded[m].vocab)));
  const names = [...nameSets[0]].filter((n) => nameSets.every((s) => s.has(n))).sort();
  const N = names.length;
  for (const m of MODELS) {
    if (Object.keys(loaded[m].vocab).length !== N) {
      console.warn(`  ! ${m} vocab size ${Object.keys(loaded[m].vocab).length} != common ${N}`);
    }
    if (loaded[m].cols !== dims) throw new Error(`${m} dim ${loaded[m].cols} != ${dims}`);
  }
  console.log(`Canonical vocabulary: ${N} ingredients, ${dims} dims\n`);

  // 3. Reindex every model into canonical order. canon[model] = Float32Array(N*dims).
  const canon = {};
  for (const m of MODELS) {
    const { vocab, flat, cols } = loaded[m];
    const out = new Float32Array(N * dims);
    for (let i = 0; i < N; i++) {
      const src = vocab[names[i]] * cols;
      out.set(flat.subarray(src, src + cols), i * dims);
    }
    canon[m] = out;
  }

  // 4. Categorical labels from the LABEL_MODEL's mode poles. For each dimension,
  //    each ingredient is assigned the family of the closest selected mode-pole.
  const labels = {};
  const legends = {};
  const dimLabels = {};
  const labelVecs = canon[LABEL_MODEL];

  const normPole = (mode) => {
    const p = Float32Array.from(mode.pole);
    let s = 0;
    for (let c = 0; c < dims; c++) s += p[c] * p[c];
    const inv = 1 / Math.max(Math.sqrt(s), 1e-9);
    for (let c = 0; c < dims; c++) p[c] *= inv;
    return p;
  };

  for (const [dim, spec] of Object.entries(COLOR_DIMS)) {
    const modes = loaded[LABEL_MODEL].modes.filter(spec.select);
    if (!modes.length) {
      console.warn(`  ! no modes matched dimension "${dim}"`);
      continue;
    }
    const families = [...new Set(modes.map(spec.family))].sort();
    const familyIndex = new Map(families.map((f, i) => [f, i]));
    const poleEntries = modes.map((m) => ({
      fam: familyIndex.get(spec.family(m)),
      pole: normPole(m),
    }));
    const nFam = families.length;

    const idx = new Int16Array(N);
    const margins = new Float32Array(N);
    const famScore = new Float32Array(nFam);
    for (let i = 0; i < N; i++) {
      // Score each family by its best-matching sub-mode pole.
      famScore.fill(-Infinity);
      for (const { fam, pole } of poleEntries) {
        const d = dot(labelVecs, i, dims, pole);
        if (d > famScore[fam]) famScore[fam] = d;
      }
      // Top-1 family and the gap to the runner-up.
      let b1 = -Infinity;
      let b2 = -Infinity;
      let bestFamily = 0;
      for (let f = 0; f < nFam; f++) {
        const s = famScore[f];
        if (s > b1) {
          b2 = b1;
          b1 = s;
          bestFamily = f;
        } else if (s > b2) {
          b2 = s;
        }
      }
      idx[i] = bestFamily;
      margins[i] = b1 - b2;
    }

    // Ambiguous items (small top-2 margin) go to an "Other" bucket so we never
    // make a confident-but-wrong claim (e.g. chicken is not a vegetable).
    if (spec.otherMargin != null) {
      const otherIdx = families.length;
      let nOther = 0;
      for (let i = 0; i < N; i++) {
        if (margins[i] < spec.otherMargin) {
          idx[i] = otherIdx;
          nOther++;
        }
      }
      families.push('Other');
      console.log(`  ${dim}: ${nOther}/${N} -> Other (margin < ${spec.otherMargin})`);
    }

    console.log(`Labels[${dim}] (${spec.label}): ${families.join(', ')}`);
    labels[dim] = Array.from(idx);
    legends[dim] = families;
    dimLabels[dim] = spec.label;
  }
  console.log('');

  // 5. UMAP 2D layout per model (deterministic seed).
  const layouts = {};
  for (const m of MODELS) {
    process.stdout.write(`UMAP [${m}] ... `);
    const t0 = Date.now();
    const data = [];
    for (let i = 0; i < N; i++) {
      data.push(Array.from(canon[m].subarray(i * dims, i * dims + dims)));
    }
    const umap = new UMAP({
      nComponents: 2,
      nNeighbors: 15,
      minDist: 0.1,
      spread: 1.0,
      random: mulberry32(0xc0ffee + m.length),
    });
    const emb = umap.fit(data);
    // Normalize layout to roughly [-100, 100] on each axis for stable camera framing.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of emb) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const scale = 200 / span;
    const coords = new Array(N * 2);
    for (let i = 0; i < N; i++) {
      coords[i * 2] = +((emb[i][0] - cx) * scale).toFixed(2);
      coords[i * 2 + 1] = +((emb[i][1] - cy) * scale).toFixed(2);
    }
    layouts[m] = coords;
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log('');

  // 6. Write vectors.bin (canonical, normalized, model order = MODELS).
  await mkdir(OUT, { recursive: true });
  const vectors = new Float32Array(MODELS.length * N * dims);
  MODELS.forEach((m, mi) => vectors.set(canon[m], mi * N * dims));
  await writeFile(join(OUT, 'vectors.bin'), Buffer.from(vectors.buffer));
  console.log(`Wrote vectors.bin (${(vectors.byteLength / 1e6).toFixed(2)} MB)`);

  const meta = {
    models: MODELS,
    labelModel: LABEL_MODEL,
    count: N,
    dims,
    names,
    layouts,
    labels,
    legends,
    dimLabels,
    attribution: {
      paper: 'Epicure: Navigating the Emergent Geometry of Food Ingredient Embeddings',
      arxiv: '2605.22391',
      authors: 'Radzikowski, Jakub and Chen, Josef',
      models: MODELS.map((m) => `Kaikaku/epicure-${m}`),
      license: 'CC BY 4.0',
      source: 'https://huggingface.co/Kaikaku',
    },
  };
  await writeFile(join(OUT, 'meta.json'), JSON.stringify(meta));
  console.log(`Wrote meta.json (${names.length} names, layouts for ${MODELS.join(', ')})\n`);

  // 7. Sanity check: neighbors("chicken") on core should match the model card.
  sanityNeighbors(canon, names, dims, 'core', 'chicken', 6);
  sanityNeighbors(canon, names, dims, 'chem', 'chicken', 6);
  sanityNeighbors(canon, names, dims, 'cooc', 'chicken', 6);
}

function sanityNeighbors(canon, names, dims, model, query, k) {
  const idx = names.indexOf(query);
  if (idx < 0) {
    console.warn(`  sanity: "${query}" not in vocab`);
    return;
  }
  const flat = canon[model];
  const v = flat.subarray(idx * dims, idx * dims + dims);
  const sims = [];
  for (let i = 0; i < names.length; i++) {
    if (i === idx) continue;
    let s = 0;
    const o = i * dims;
    for (let c = 0; c < dims; c++) s += flat[o + c] * v[c];
    sims.push([names[i], s]);
  }
  sims.sort((a, b) => b[1] - a[1]);
  const top = sims.slice(0, k).map(([n, s]) => `${n} ${s.toFixed(2)}`);
  console.log(`neighbors[${model}]("${query}") = ${top.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
