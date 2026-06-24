import './styles.css';
import { Engine } from './engine';
import { Store } from './state';
import { createSpine } from './spine';
import { createGalaxy } from './galaxy';
import { familyHex, REPO_URL } from './config';

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
    <div class="topbar-right">
      <a class="repo-link" href="${REPO_URL}" target="_blank" rel="noopener"
         aria-label="View the source on GitHub" title="View the source on GitHub">
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        <span>GitHub</span>
      </a>
      <div class="hints">
        <span><kbd>drag</kbd> pan</span>
        <span><kbd>scroll</kbd> zoom</span>
        <span><kbd>click</kbd> a star</span>
      </div>
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
