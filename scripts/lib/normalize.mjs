// Pure ingredient-term -> canonical-node mapping. No I/O, no deps, so it is
// unit-testable in isolation and reusable by both the offline recipe pipeline
// and the backend's seed builder.
//
// The canonical vocabulary (public/data/meta.json `names`) is American-English,
// snake_case, and overwhelmingly singular: `scallion` not `green_onion`, `egg`
// not `eggs`, `parmesan_cheese` not `parmesan`. The mapper resolves a raw food
// term to one canonical name (or null) via a fixed cascade, recording which
// stage matched so every decision is auditable.

const PREP_ADJECTIVES = new Set([
  'fresh', 'dried', 'frozen', 'chopped', 'minced', 'ground', 'grated', 'sliced',
  'diced', 'crushed', 'shredded', 'cooked', 'raw', 'whole', 'large', 'small',
  'medium', 'boneless', 'skinless', 'ripe', 'peeled', 'roasted', 'toasted',
  'organic', 'unsalted', 'salted', 'extra', 'fine', 'coarse', 'hot', 'cold',
  'warm', 'softened', 'melted', 'finely', 'roughly', 'thinly',
]);

// Strip accents, lowercase, drop punctuation, collapse whitespace, and join on
// underscores so "Crème Fraîche" -> "creme_fraiche" and "green onion" ->
// "green_onion".
export function normalizeTerm(raw) {
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/[\s_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

// A second candidate with leading prep adjectives removed: "fresh_basil_leaves"
// -> "basil_leaves". Never destroys the original; the cascade tries both.
export function stripPrepAdjectives(norm) {
  const parts = norm.split('_');
  let i = 0;
  while (i < parts.length - 1 && PREP_ADJECTIVES.has(parts[i])) i++;
  return parts.slice(i).join('_');
}

// Best-effort English singularization of a single token. Conservative: only the
// common, unambiguous suffix rules. The cascade only *accepts* the result if it
// is an exact canonical name, so an over-eager rule never produces a bad map.
export function singularizeToken(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return token.slice(0, -3) + 'y';
  if (token.endsWith('ves')) return token.slice(0, -3) + 'f';
  if (token.endsWith('oes')) return token.slice(0, -2);
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (token.endsWith('shes') || token.endsWith('ches')) return token.slice(0, -2);
  if (token.endsWith('ss')) return token; // "watercress" stays
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

// Singularize the whole key and, separately, just its head (last) token.
export function singularCandidates(norm) {
  const parts = norm.split('_');
  const cands = new Set();
  cands.add(singularizeToken(norm));
  if (parts.length > 1) {
    const head = [...parts];
    head[head.length - 1] = singularizeToken(head[head.length - 1]);
    cands.add(head.join('_'));
  }
  cands.delete(norm);
  return [...cands];
}

// Progressively shorter trailing sub-phrases ending at the head noun, longest
// first: "smoked_streaky_bacon" -> ["streaky_bacon", "bacon"].
export function headNounCandidates(norm) {
  const parts = norm.split('_');
  const out = [];
  for (let start = 1; start < parts.length; start++) {
    out.push(parts.slice(start).join('_'));
  }
  return out;
}

// Damerau-Levenshtein, capped: returns true if edit distance <= 1 (one
// substitution, insertion, deletion, or adjacent transposition).
export function withinEditDistance1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    let diff = -1, diffs = 0;
    for (let i = 0; i < la; i++) {
      if (a[i] !== b[i]) {
        diffs++;
        if (diffs > 2) return false;
        if (diff === -1) diff = i;
      }
    }
    if (diffs <= 1) return true;
    // exactly two diffs: allow only an adjacent transposition
    return diffs === 2 && diff + 1 < la && a[diff] === b[diff + 1] && a[diff + 1] === b[diff];
  }
  // lengths differ by 1: check the shorter is the longer with one char removed
  const [short, long] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++;
  }
  return true;
}

// Build a reusable mapper over a canonical name list + alias table. The alias
// targets are validated against the names; an alias pointing at a non-canonical
// name is dropped (and surfaced via `invalidAliases`) so a typo can't silently
// poison the mapping.
export function createMapper(names, aliasTable = {}) {
  const nameSet = new Set(names);
  const byFirst = new Map(); // first letter -> canonical names (for fuzzy)
  for (const n of names) {
    const c = n[0];
    if (!byFirst.has(c)) byFirst.set(c, []);
    byFirst.get(c).push(n);
  }

  const aliases = new Map();
  const invalidAliases = [];
  for (const [k, v] of Object.entries(aliasTable)) {
    const target = normalizeTerm(v);
    if (nameSet.has(target)) aliases.set(normalizeTerm(k), target);
    else invalidAliases.push({ alias: k, target: v });
  }

  function mapTerm(raw) {
    const norm = normalizeTerm(raw);
    if (!norm) return { node: null, name: null, via: 'empty', norm };
    const candidates = [norm];
    const stripped = stripPrepAdjectives(norm);
    if (stripped && stripped !== norm) candidates.push(stripped);

    // 2. exact
    for (const c of candidates) if (nameSet.has(c)) return hit(c, 'exact', norm);
    // 3. alias
    for (const c of candidates) if (aliases.has(c)) return hit(aliases.get(c), 'alias', norm);
    // 4. singular/plural
    for (const c of candidates) {
      for (const s of singularCandidates(c)) {
        if (nameSet.has(s)) return hit(s, 'plural', norm);
        if (aliases.has(s)) return hit(aliases.get(s), 'alias', norm);
      }
    }
    // 5. head-noun (longest canonical trailing sub-phrase)
    for (const c of candidates) {
      for (const h of headNounCandidates(c)) {
        if (nameSet.has(h)) return hit(h, 'head_noun', norm);
      }
    }
    // 6. bounded fuzzy (typos only)
    for (const c of candidates) {
      if (c.length < 5) continue;
      const pool = byFirst.get(c[0]) || [];
      for (const n of pool) {
        if (Math.abs(n.length - c.length) > 1) continue;
        if (withinEditDistance1(c, n)) return hit(n, 'fuzzy', norm);
      }
    }
    return { node: null, name: null, via: 'unmatched', norm };
  }

  function hit(name, via, norm) {
    return { node: nameToIndex.get(name), name, via, norm };
  }

  const nameToIndex = new Map(names.map((n, i) => [n, i]));

  // Map a recipe's raw ingredient terms to a deduped, sorted array of node
  // indices, plus the list of terms that did not map (for auditing). `mappedCount`
  // is the number of ingredient terms that resolved to a node (before dedup), so
  // callers can compute coverage as "fraction of ingredients that mapped" rather
  // than the distinct-node count, which understates it when two terms share a node.
  function mapRecipe(terms) {
    const nodes = new Set();
    const unmapped = [];
    let mappedCount = 0;
    for (const t of terms) {
      const r = mapTerm(t);
      if (r.node != null) {
        nodes.add(r.node);
        mappedCount++;
      } else if (r.via !== 'empty') {
        unmapped.push(t);
      }
    }
    return { nodeIndices: [...nodes].sort((a, b) => a - b), unmapped, mappedCount };
  }

  return { mapTerm, mapRecipe, invalidAliases, nameToIndex };
}
