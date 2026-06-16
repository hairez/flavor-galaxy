// Loads the precomputed embedding assets and exposes the core similarity ops.
// All vectors are L2-normalized at build time, so cosine similarity == dot product.

export interface Attribution {
  paper: string;
  arxiv: string;
  authors: string;
  models: string[];
  license: string;
  source: string;
}

export interface Meta {
  models: string[];
  labelModel: string;
  count: number;
  dims: number;
  names: string[];
  layouts: Record<string, number[]>; // model -> flat [x0,y0,x1,y1,...]
  labels: Record<string, number[]>; // dim -> per-ingredient family index
  legends: Record<string, string[]>; // dim -> family names
  dimLabels: Record<string, string>; // dim -> display label
  attribution: Attribution;
}

export interface Neighbor {
  index: number;
  name: string;
  score: number;
}

export class Engine {
  readonly meta: Meta;
  private readonly vectors: Float32Array;
  private readonly nameToIndex: Map<string, number>;
  private readonly modelOffset: Map<string, number>;

  constructor(meta: Meta, vectors: Float32Array) {
    this.meta = meta;
    this.vectors = vectors;
    this.nameToIndex = new Map(meta.names.map((n, i) => [n, i]));
    this.modelOffset = new Map(
      meta.models.map((m, i) => [m, i * meta.count * meta.dims]),
    );
  }

  static async load(baseUrl: string): Promise<Engine> {
    const [meta, buf] = await Promise.all([
      fetch(`${baseUrl}data/meta.json`).then((r) => r.json() as Promise<Meta>),
      fetch(`${baseUrl}data/vectors.bin`).then((r) => r.arrayBuffer()),
    ]);
    const vectors = new Float32Array(buf);
    const expected = meta.models.length * meta.count * meta.dims;
    if (vectors.length !== expected) {
      throw new Error(`vectors.bin length ${vectors.length} != expected ${expected}`);
    }
    return new Engine(meta, vectors);
  }

  get count(): number {
    return this.meta.count;
  }

  indexOf(name: string): number | undefined {
    return this.nameToIndex.get(name);
  }

  name(index: number): string {
    return this.meta.names[index];
  }

  private base(model: string): number {
    const o = this.modelOffset.get(model);
    if (o === undefined) throw new Error(`unknown model "${model}"`);
    return o;
  }

  vector(index: number, model: string): Float32Array {
    const start = this.base(model) + index * this.meta.dims;
    return this.vectors.subarray(start, start + this.meta.dims);
  }

  neighbors(index: number, model: string, k: number): Neighbor[] {
    const { count, dims } = this.meta;
    const base = this.base(model);
    const q = base + index * dims;
    const v = this.vectors;
    const scores = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      if (i === index) {
        scores[i] = -Infinity;
        continue;
      }
      const o = base + i * dims;
      let s = 0;
      for (let c = 0; c < dims; c++) s += v[o + c] * v[q + c];
      scores[i] = s;
    }
    // Partial selection of top-k.
    const order = Array.from({ length: count }, (_, i) => i);
    order.sort((a, b) => scores[b] - scores[a]);
    const out: Neighbor[] = [];
    for (let j = 0; j < k && j < order.length; j++) {
      const idx = order[j];
      out.push({ index: idx, name: this.meta.names[idx], score: scores[idx] });
    }
    return out;
  }

  // Cosine similarity between two ingredients under a given model.
  similarity(a: number, b: number, model: string): number {
    const base = this.base(model);
    const dims = this.meta.dims;
    const oa = base + a * dims;
    const ob = base + b * dims;
    const v = this.vectors;
    let s = 0;
    for (let c = 0; c < dims; c++) s += v[oa + c] * v[ob + c];
    return s;
  }

  layout(model: string): number[] {
    return this.meta.layouts[model];
  }

  labelIndex(dim: string, index: number): number {
    return this.meta.labels[dim][index];
  }

  legend(dim: string): string[] {
    return this.meta.legends[dim];
  }
}

// snake_case ingredient ids -> display text, e.g. "chicken_broth" -> "chicken broth".
export function pretty(name: string): string {
  return name.replace(/_/g, ' ');
}
