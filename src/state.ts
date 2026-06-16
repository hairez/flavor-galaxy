// Minimal shared store. The spine and the galaxy both read and write it, which
// is what keeps the two views in sync (select in one, it lights up in the other).

export type ModelId = string;
export type ColorDim = string;

export interface AppState {
  model: ModelId;
  colorBy: ColorDim;
  selected: number | null; // ingredient index
  hovered: number | null;
  neighborK: number;
}

type Listener = (state: AppState, changed: Set<keyof AppState>) => void;

export class Store {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor(initial: AppState) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    const changed = new Set<keyof AppState>();
    for (const key of Object.keys(patch) as (keyof AppState)[]) {
      if (this.state[key] !== patch[key]) changed.add(key);
    }
    if (changed.size === 0) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state, changed);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
