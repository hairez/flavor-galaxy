// The spine: model spectrum control, ingredient search, and the live nearest-
// neighbor list. This is the analytical core; the galaxy is its visual twin.

import { Engine, pretty } from '../engine';
import { Store } from '../state';
import { MODEL_META, SPECTRUM_ENDS, familyHex } from '../config';
import { resolveImage } from '../images';

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

  // --- Search ---
  const input = h('input', {
    class: 'search-input',
    type: 'text',
    placeholder: 'Search 1,790 ingredients…',
    autocomplete: 'off',
    spellcheck: 'false',
  }) as HTMLInputElement;
  const results = h('ul', { class: 'search-results', hidden: 'true' });
  const search = h('div', { class: 'search' }, [input, results]);

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
          store.set({ selected: idx });
        });
        return li;
      }),
    );
    results.removeAttribute('hidden');
  }

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('focus', () => {
    if (input.value) renderResults(input.value);
  });
  input.addEventListener('blur', () => setTimeout(closeResults, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = results.querySelector<HTMLLIElement>('.search-result');
      first?.dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      closeResults();
      input.blur();
    }
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
      const row = h('li', { class: 'neighbor', 'data-index': String(nb.index) }, [
        h('span', { class: 'nb-name' }, [pretty(nb.name)]),
        h('span', { class: 'nb-bar' }, [
          h('span', { class: 'nb-fill', style: `width:${(pct * 100).toFixed(1)}%` }),
        ]),
        h('span', { class: 'nb-score' }, [nb.score.toFixed(2)]),
      ]);
      row.addEventListener('click', () => {
        input.value = pretty(nb.name);
        store.set({ selected: nb.index });
      });
      row.addEventListener('mouseenter', () => store.set({ hovered: nb.index }));
      row.addEventListener('mouseleave', () => store.set({ hovered: null }));
      list.append(row);
    }
    const heading = h('div', { class: 'neighbors-heading' }, [
      h('span', {}, ['Closest by ']),
      h('strong', {}, [MODEL_META.find((m) => m.id === model)?.short ?? model]),
    ]);
    detail.replaceChildren(head, heading, list);
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
      h('label', { class: 'section-label' }, ['Ingredient']),
      search,
    ]),
    detail,
  );

  store.subscribe((_, changed) => {
    if (changed.has('model')) syncModel();
    if (changed.has('selected') || changed.has('model')) renderDetail();
  });

  syncModel();
  renderDetail();
}
