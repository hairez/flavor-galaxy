// The spine: model spectrum control, ingredient search, and the live nearest-
// neighbor list. This is the analytical core; the galaxy is its visual twin.

import { Engine, pretty } from '../engine';
import { Store, pickIngredient, pickRecipe } from '../state';
import { MODEL_META, SPECTRUM_ENDS, familyHex } from '../config';
import { resolveImage } from '../images';
import { searchRecipes, sampleRecipes, recipeSearchAvailable, type RecipeHit } from '../recipes';

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Partial<Record<string, string>> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function createSpine(root: HTMLElement, engine: Engine, store: Store): void {
  root.classList.add('spine');

  // --- Model spectrum control ---
  const modelButtons = new Map<string, HTMLButtonElement>();
  const spectrum = h('div', { class: 'spectrum' });
  const ends = h('div', { class: 'spectrum-ends' }, [
    h('span', {}, [SPECTRUM_ENDS.left]),
    h('span', {}, [SPECTRUM_ENDS.right]),
  ]);
  const stops = h('div', { class: 'spectrum-stops' });
  for (const m of MODEL_META) {
    const btn = h('button', { class: 'stop', type: 'button', 'data-model': m.id }, [
      h('span', { class: 'stop-name' }, [m.short]),
      h('span', { class: 'stop-tag' }, [m.tagline]),
    ]);
    btn.addEventListener('click', () => store.set({ model: m.id }));
    modelButtons.set(m.id, btn);
    stops.append(btn);
  }
  spectrum.append(ends, stops);

  // --- Search (two modes sharing one input: ingredients are matched locally and
  // synchronously; recipes are fetched from the API, async, debounced) ---
  type SearchMode = 'ingredient' | 'recipe';
  let mode: SearchMode = 'ingredient';

  const input = h('input', {
    class: 'search-input',
    type: 'text',
    placeholder: 'Search 1,790 ingredients…',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const results = h('ul', { class: 'search-results', hidden: 'true' });

  const modeButtons = new Map<SearchMode, HTMLButtonElement>();
  const modeToggle = h('div', { class: 'search-modes', role: 'tablist' });
  for (const m of [
    { id: 'ingredient' as const, label: 'Ingredients' },
    { id: 'recipe' as const, label: 'Recipes' },
  ]) {
    const btn = h('button', { class: 'search-mode', type: 'button' }, [m.label]) as HTMLButtonElement;
    btn.addEventListener('click', () => setMode(m.id));
    modeButtons.set(m.id, btn);
    modeToggle.append(btn);
  }

  const search = h('div', { class: 'search' }, [modeToggle, input, results]);

  function syncModeButtons(): void {
    for (const [id, btn] of modeButtons) btn.classList.toggle('active', id === mode);
  }

  function setMode(next: SearchMode): void {
    if (next === mode) return;
    mode = next;
    // Abandon any scheduled or in-flight recipe search so a late result can't
    // reopen the dropdown in the wrong mode. closeResults() alone is insufficient
    // because the debounce timer / fetch resolve later.
    cancelRecipeSearch();
    syncModeButtons();
    input.placeholder =
      mode === 'ingredient' ? 'Search 1,790 ingredients…' : 'Search recipes…';
    input.value = '';
    closeResults();
    input.focus();
    // Recipe mode greets with suggestions (works even with no search backend);
    // the "unavailable" notice only surfaces once the user actually types.
    if (mode === 'recipe') openSuggestions();
  }

  function closeResults(): void {
    results.replaceChildren();
    results.setAttribute('hidden', 'true');
  }

  function renderResults(query: string): void {
    const q = query.trim().toLowerCase().replace(/\s+/g, '_');
    if (!q) return closeResults();
    const names = engine.meta.names;
    const starts: number[] = [];
    const contains: number[] = [];
    for (let i = 0; i < names.length; i++) {
      const n = names[i];
      if (n.startsWith(q)) starts.push(i);
      else if (n.includes(q)) contains.push(i);
      if (starts.length >= 12) break;
    }
    const matches = [...starts, ...contains].slice(0, 12);
    if (!matches.length) {
      results.replaceChildren(h('li', { class: 'search-empty' }, ['no matches']));
      results.removeAttribute('hidden');
      return;
    }
    results.replaceChildren(
      ...matches.map((idx) => {
        const li = h('li', { class: 'search-result' }, [pretty(names[idx])]);
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          input.value = pretty(names[idx]);
          closeResults();
          pickIngredient(store, idx);
        });
        return li;
      }),
    );
    results.removeAttribute('hidden');
  }

  // --- Recipe search (async/remote) ---
  let debTimer: number | null = null;
  let inFlight: AbortController | null = null;
  let seq = 0;

  function showResultMessage(cls: string, text: string): void {
    results.replaceChildren(h('li', { class: cls }, [text]));
    results.removeAttribute('hidden');
  }

  // Cancel a pending debounce and abort an in-flight request, and bump `seq` so a
  // fetch that resolves after cancellation is treated as superseded.
  function cancelRecipeSearch(): void {
    if (debTimer) {
      clearTimeout(debTimer);
      debTimer = null;
    }
    inFlight?.abort();
    inFlight = null;
    seq++;
  }

  function scheduleRecipeSearch(raw: string): void {
    const q = raw.trim();
    if (debTimer) clearTimeout(debTimer);
    if (!recipeSearchAvailable) return showResultMessage('search-empty', 'recipe search is unavailable');
    if (!q) return closeResults();
    debTimer = window.setTimeout(() => runRecipeSearch(q), 220);
  }

  async function runRecipeSearch(q: string): Promise<void> {
    inFlight?.abort();
    inFlight = new AbortController();
    const my = ++seq;
    showResultMessage('search-empty', 'searching…');
    try {
      const hits = await searchRecipes(q, inFlight.signal);
      if (my !== seq) return; // a newer query superseded this one
      renderRecipeResults(hits);
    } catch (err) {
      if ((err as Error).name === 'AbortError' || my !== seq) return;
      showResultMessage('search-empty', 'search unavailable');
    }
  }

  function recipeRow(hit: RecipeHit): HTMLLIElement {
    // A recipe whose nodes all fall outside the current map (e.g. stale data)
    // would otherwise select an empty constellation and dim the whole galaxy.
    const nodes = hit.nodeIndices.filter((i) => i >= 0 && i < engine.count);
    const selectable = nodes.length > 0;
    const li = h('li', { class: selectable ? 'search-result' : 'search-result disabled' }, [
      hit.title,
    ]) as HTMLLIElement;
    if (!selectable) li.setAttribute('title', 'no mapped ingredients on the map');
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (!selectable) return;
      input.value = hit.title;
      closeResults();
      pickRecipe(store, { id: hit.id, title: hit.title, nodeIndices: nodes });
    });
    return li;
  }

  function renderRecipeResults(hits: RecipeHit[]): void {
    if (!hits.length) return showResultMessage('search-empty', 'no recipes found');
    results.replaceChildren(...hits.map(recipeRow));
    results.removeAttribute('hidden');
  }

  // The "suggested recipes" popup: a fresh random sample from the bundled corpus,
  // shown when the empty recipe box is hovered or focused. Static (no backend), so
  // it works even when live search is unavailable. Re-samples on each open, and is
  // a no-op outside recipe mode or once the user has typed a query.
  function openSuggestions(): void {
    if (mode !== 'recipe' || input.value.trim()) return;
    cancelRecipeSearch(); // don't let a stale in-flight search overwrite the popup
    const hits = sampleRecipes(6);
    if (!hits.length) return;
    results.replaceChildren(
      h('li', { class: 'search-suggest-header' }, ['Suggested recipes']),
      ...hits.map(recipeRow),
    );
    results.removeAttribute('hidden');
  }

  // The suggestions popup can be opened by hover, so closing can't be a plain
  // blur handler: it must not fire while the pointer is still over .search (moving
  // from the input down onto a row) nor while the input is focused. Delayed so a
  // row's mousedown lands before the list is torn down.
  let hoveringSearch = false;
  function maybeClose(): void {
    setTimeout(() => {
      if (document.activeElement === input || hoveringSearch) return;
      closeResults();
    }, 120);
  }

  input.addEventListener('input', () => {
    if (mode === 'ingredient') renderResults(input.value);
    else if (input.value.trim()) scheduleRecipeSearch(input.value);
    else openSuggestions(); // box cleared: bring the suggestions back
  });
  input.addEventListener('focus', () => {
    if (mode === 'ingredient') {
      if (input.value) renderResults(input.value);
    } else {
      openSuggestions();
    }
  });
  input.addEventListener('blur', maybeClose);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector<HTMLLIElement>('.search-result');
      first?.dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      closeResults();
      input.blur();
    }
  });

  search.addEventListener('mouseenter', () => {
    hoveringSearch = true;
    openSuggestions();
  });
  search.addEventListener('mouseleave', () => {
    hoveringSearch = false;
    maybeClose();
  });

  // --- Detail + neighbors ---
  const detail = h('div', { class: 'detail' });

  // Returns null when the label is the low-confidence "Other" bucket, so we
  // never show a misleading per-ingredient claim (e.g. "chicken is a vegetable").
  function chip(dim: string, idx: number): HTMLElement | null {
    const fam = engine.legend(dim)[idx];
    if (fam === 'Other') return null;
    return h('span', { class: 'chip', style: `--chip:${familyHex(fam, idx)}` }, [
      h('span', { class: 'chip-dot' }),
      `${engine.meta.dimLabels[dim]}: ${fam}`,
    ]);
  }

  function buildPhoto(name: string): HTMLElement {
    const fig = h('figure', { class: 'photo loading' });
    const ph = h('div', { class: 'photo-ph' }, [pretty(name).charAt(0).toUpperCase()]);
    const img = h('img', { class: 'photo-img', alt: pretty(name), loading: 'lazy' }) as HTMLImageElement;
    const cap = h('figcaption', { class: 'photo-cap' });
    fig.append(ph, img, cap);
    resolveImage(name).then((res) => {
      fig.classList.remove('loading');
      if (!res) return;
      img.addEventListener('load', () => fig.classList.add('has-img'));
      img.addEventListener('error', () => fig.classList.remove('has-img'));
      img.src = res.url;
      const link = h('a', { href: res.sourceUrl, target: '_blank', rel: 'noopener' }, [res.source]);
      cap.replaceChildren(link);
    });
    return fig;
  }

  // One neighbor/ingredient row: name plus optional trailing children (the score
  // bar), with the click-to-drill and hover wiring shared by both detail views.
  function neighborRow(index: number, label: string, extra: Node[] = []): HTMLLIElement {
    const row = h('li', { class: 'neighbor', 'data-index': String(index) }, [
      h('span', { class: 'nb-name' }, [label]),
      ...extra,
    ]) as HTMLLIElement;
    row.addEventListener('click', () => {
      input.value = label;
      pickIngredient(store, index);
    });
    row.addEventListener('mouseenter', () => store.set({ hovered: index }));
    row.addEventListener('mouseleave', () => store.set({ hovered: null }));
    return row;
  }

  function renderDetail(): void {
    const { selected, model } = store.get();
    if (selected == null) {
      detail.replaceChildren(
        h('p', { class: 'hint' }, [
          'Search for an ingredient, or click a point in the galaxy. ',
          'Switch models above to watch its neighbors shift along the chemistry / context spectrum.',
        ]),
      );
      return;
    }
    const name = engine.name(selected);
    const chips = h(
      'div',
      { class: 'chips' },
      [
        chip('food_group', engine.labelIndex('food_group', selected)),
        chip('aroma', engine.labelIndex('aroma', selected)),
        chip('taste', engine.labelIndex('taste', selected)),
      ].filter((c): c is HTMLElement => c !== null),
    );
    const head = h('div', { class: 'detail-head' }, [
      buildPhoto(name),
      h('div', { class: 'detail-head-text' }, [
        h('h2', { class: 'detail-name' }, [pretty(name)]),
        chips,
      ]),
    ]);

    const neighbors = engine.neighbors(selected, model, store.get().neighborK);
    const list = h('ol', { class: 'neighbors' });
    for (const nb of neighbors) {
      const pct = Math.max(0, Math.min(1, nb.score));
      list.append(
        neighborRow(nb.index, pretty(nb.name), [
          h('span', { class: 'nb-bar' }, [
            h('span', { class: 'nb-fill', style: `width:${(pct * 100).toFixed(1)}%` }),
          ]),
          h('span', { class: 'nb-score' }, [nb.score.toFixed(2)]),
        ]),
      );
    }
    const heading = h('div', { class: 'neighbors-heading' }, [
      h('span', {}, ['Closest by ']),
      h('strong', {}, [MODEL_META.find((m) => m.id === model)?.short ?? model]),
    ]);
    detail.replaceChildren(head, heading, list);
  }

  // When a recipe is selected, the panel lists its mapped ingredient stars.
  // Clicking one drills into that single ingredient (clearing the recipe).
  function renderRecipeDetail(): void {
    const rec = store.get().selectedRecipe;
    if (!rec) return;
    const head = h('div', { class: 'detail-head' }, [
      h('div', { class: 'detail-head-text' }, [
        h('h2', { class: 'detail-name' }, [rec.title]),
        h('span', { class: 'recipe-count' }, [
          `${rec.nodeIndices.length} ingredient${rec.nodeIndices.length === 1 ? '' : 's'} on the map`,
        ]),
      ]),
    ]);
    const list = h('ol', { class: 'neighbors' });
    for (const idx of rec.nodeIndices) {
      list.append(neighborRow(idx, pretty(engine.name(idx))));
    }
    const heading = h('div', { class: 'neighbors-heading' }, [
      h('span', {}, ['Ingredients in this recipe']),
    ]);
    detail.replaceChildren(head, heading, list);
  }

  // Route the detail panel between the recipe and single-ingredient views.
  function renderPanel(): void {
    if (store.get().selectedRecipe) renderRecipeDetail();
    else renderDetail();
  }

  function syncModel(): void {
    const { model } = store.get();
    for (const [id, btn] of modelButtons) {
      btn.classList.toggle('active', id === model);
    }
  }

  root.replaceChildren(
    h('div', { class: 'spine-section' }, [
      h('label', { class: 'section-label' }, ['Embedding model']),
      spectrum,
    ]),
    h('div', { class: 'spine-section' }, [
      h('label', { class: 'section-label' }, ['Search']),
      search,
    ]),
    detail,
  );

  syncModeButtons();

  store.subscribe((_, changed) => {
    if (changed.has('model')) syncModel();
    if (changed.has('selected') || changed.has('model') || changed.has('selectedRecipe')) {
      renderPanel();
    }
  });

  syncModel();
  renderPanel();
}
