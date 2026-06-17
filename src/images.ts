// Resolves an ingredient photo. A curated manifest (public/data/images.json),
// built by an offline audit that actually viewed every candidate photo, is
// consulted first so results are correct and deterministic. Anything not in the
// manifest falls back to a live lookup: TheMealDB's clean ingredient photos,
// then a Wikipedia page thumbnail, then a placeholder. Results are cached in
// memory and in localStorage so a given ingredient is only resolved once.

export interface ImageResult {
  url: string;
  source: string;
  sourceUrl: string;
}

const LS_PREFIX = 'fg:img:v1:';
const pending = new Map<string, Promise<ImageResult | null>>();
const resolved = new Map<string, ImageResult | null>();

let manifest: Record<string, ImageResult> | null = null;
let manifestPromise: Promise<void> | null = null;
function loadManifest(): Promise<void> {
  if (!manifestPromise) {
    manifestPromise = fetch(`${import.meta.env.BASE_URL}data/images.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, ImageResult>>) : {}))
      .then((m) => {
        manifest = m;
      })
      .catch(() => {
        manifest = {};
      });
  }
  return manifestPromise;
}
loadManifest();

const titlecase = (s: string) =>
  s
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

function imageLoads(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 1);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function tryMealDb(name: string): Promise<ImageResult | null> {
  const url = `https://www.themealdb.com/images/ingredients/${encodeURIComponent(
    titlecase(name),
  )}-Small.png`;
  return (await imageLoads(url))
    ? { url, source: 'TheMealDB', sourceUrl: 'https://www.themealdb.com' }
    : null;
}

async function tryWikipedia(name: string): Promise<ImageResult | null> {
  const title = encodeURIComponent(name.replace(/_/g, ' '));
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`,
    );
    if (!res.ok) return null;
    const j = await res.json();
    if (j.type !== 'standard') return null; // skip disambiguation / missing pages
    const thumb: string | undefined = j.thumbnail?.source;
    if (!thumb) return null;
    return {
      url: thumb,
      source: 'Wikipedia',
      sourceUrl: j.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${title}`,
    };
  } catch {
    return null;
  }
}

function readLs(name: string): ImageResult | null | undefined {
  try {
    const raw = localStorage.getItem(LS_PREFIX + name);
    if (raw == null) return undefined;
    return JSON.parse(raw) as ImageResult | null;
  } catch {
    return undefined;
  }
}

function writeLs(name: string, value: ImageResult | null): void {
  try {
    localStorage.setItem(LS_PREFIX + name, JSON.stringify(value));
  } catch {
    /* localStorage may be full or blocked; cache stays in-memory only */
  }
}

async function resolveUncached(name: string): Promise<ImageResult | null> {
  await loadManifest();
  const curated = manifest?.[name];
  if (curated) {
    resolved.set(name, curated);
    return curated;
  }
  const cached = readLs(name);
  if (cached !== undefined) {
    resolved.set(name, cached);
    return cached;
  }
  const result = (await tryMealDb(name)) ?? (await tryWikipedia(name));
  resolved.set(name, result);
  writeLs(name, result);
  return result;
}

export function resolveImage(name: string): Promise<ImageResult | null> {
  let p = pending.get(name);
  if (!p) {
    p = resolveUncached(name);
    pending.set(name, p);
  }
  return p;
}

// Synchronous peek for instant hover display. Returns undefined if not yet known.
export function peekImage(name: string): ImageResult | null | undefined {
  const curated = manifest?.[name];
  if (curated) return curated;
  if (resolved.has(name)) return resolved.get(name);
  return readLs(name);
}
