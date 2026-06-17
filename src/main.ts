import './styles.css';
import { Engine } from './engine';
import { Store } from './state';
import { createSpine } from './spine';
import { createGalaxy } from './galaxy';
import { familyHex } from './config';

const app = document.getElementById('app')!;

function loading(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'loading';
  el.innerHTML = `<div class="loading-orb"></div><p>Mapping 1,790 ingredients…</p>`;
  return el;
}

function buildLegend(engine: Engine, store: Store): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'legend';

  const dims = Object.keys(engine.meta.dimLabels);
  const tabs = document.createElement('div');
  tabs.className = 'legend-tabs';
  const tabButtons = new Map<string, HTMLButtonElement>();
  for (const dim of dims) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'legend-tab';
    btn.textContent = engine.meta.dimLabels[dim];
    btn.addEventListener('click', () => store.set({ colorBy: dim }));
    tabButtons.set(dim, btn);
    tabs.append(btn);
  }

  const swatches = document.createElement('div');
  swatches.className = 'legend-swatches';

  function render(): void {
    const { colorBy } = store.get();
    for (const [dim, btn] of tabButtons) btn.classList.toggle('active', dim === colorBy);
    const names = engine.legend(colorBy);
    swatches.replaceChildren(
      ...names.map((name, i) => {
        const s = document.createElement('span');
        s.className = 'swatch';
        const dot = document.createElement('span');
        dot.className = 'swatch-dot';
        dot.style.background = familyHex(name, i);
        s.append(dot, document.createTextNode(name));
        return s;
      }),
    );
  }

  panel.append(
    Object.assign(document.createElement('div'), {
      className: 'legend-title',
      textContent: 'Color by',
    }),
    tabs,
    swatches,
  );
  store.subscribe((_, changed) => {
    if (changed.has('colorBy')) render();
  });
  render();
  return panel;
}

function buildChrome(engine: Engine): { galaxyRoot: HTMLDivElement; spineRoot: HTMLElement } {
  const a = engine.meta.attribution;
  app.replaceChildren();

  const galaxyRoot = document.createElement('div');
  galaxyRoot.className = 'galaxy-root';

  const topbar = document.createElement('header');
  topbar.className = 'topbar';
  topbar.innerHTML = `
    <div class="brand">
      <h1>Flavor&nbsp;Galaxy</h1>
      <p>1,790 ingredients · 4M recipes · the geometry of taste</p>
    </div>
    <div class="hints">
      <span><kbd>drag</kbd> pan</span>
      <span><kbd>scroll</kbd> zoom</span>
      <span><kbd>click</kbd> a star</span>
    </div>`;

  const spineRoot = document.createElement('aside');

  const footer = document.createElement('footer');
  footer.className = 'attribution';
  footer.innerHTML = `
    Embeddings from <a href="https://arxiv.org/abs/${a.arxiv}" target="_blank" rel="noopener">Epicure</a>
    (${a.authors}) · models <a href="${a.source}" target="_blank" rel="noopener">${a.models.join(', ')}</a>
    · ${a.license}`;

  app.append(galaxyRoot, topbar, spineRoot, footer);
  return { galaxyRoot, spineRoot };
}

async function main(): Promise<void> {
  app.append(loading());
  let engine: Engine;
  try {
    engine = await Engine.load(import.meta.env.BASE_URL);
  } catch (err) {
    app.replaceChildren(
      Object.assign(document.createElement('div'), {
        className: 'error',
        textContent: `Failed to load ingredient data: ${(err as Error).message}`,
      }),
    );
    throw err;
  }

  const store = new Store({
    model: 'core',
    colorBy: 'food_group',
    selected: null,
    hovered: null,
    neighborK: 8,
    selectedRecipe: null,
  });

  const { galaxyRoot, spineRoot } = buildChrome(engine);
  createGalaxy(galaxyRoot, engine, store);
  createSpine(spineRoot, engine, store);
  spineRoot.append(buildLegend(engine, store));

  const note = document.createElement('p');
  note.className = 'map-note';
  note.append(
    document.createElement('strong'),
    document.createTextNode(
      ' Distance is the meaning: nearby stars are similar ingredients. ' +
        'The map is a UMAP projection of 300-D vectors, so the axes have no fixed ' +
        'units - and each model draws its own layout.',
    ),
  );
  note.querySelector('strong')!.textContent = 'Reading the map.';
  spineRoot.append(note);
}

main();
