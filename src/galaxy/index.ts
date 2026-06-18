// The galaxy: a WebGL scatter of all 1,790 ingredients laid out by UMAP. Points
// keep their (food-group / aroma / taste) color across all three models, so when
// you switch models the whole cloud re-forms and you can watch where a category
// drifts. Selecting an ingredient draws its constellation of nearest neighbors.

import { Deck, OrthographicView } from '@deck.gl/core';
import { ScatterplotLayer, LineLayer, TextLayer } from '@deck.gl/layers';
import { Engine, pretty } from '../engine';
import { Store, pickIngredient } from '../state';
import { familyRgb } from '../config';
import { resolveImage, peekImage } from '../images';

type RGBA = [number, number, number, number];

const DIM_ALPHA = 34;
const BASE_ALPHA = 200;

export function createGalaxy(container: HTMLDivElement, engine: Engine, store: Store): void {
  const count = engine.count;
  const data = Array.from({ length: count }, (_, i) => i);
  // `coords` is a mutable working copy that we tween between layouts ourselves, so
  // points, links and labels all read the same positions and move in lockstep.
  let coords = Float32Array.from(engine.layout(store.get().model));
  let frame = 0; // bumped each animation tick to force deck.gl to re-read positions
  let raf: number | null = null;
  let neighborSet = new Set<number>();
  let neighborList: number[] = [];
  // A recipe selection lights up this whole set at once (its constellation).
  let recipeSet = new Set<number>();
  let recipeList: number[] = [];

  const pos = (i: number): [number, number] => [coords[i * 2], coords[i * 2 + 1]];

  function recomputeNeighbors(): void {
    const { selected, model, neighborK, selectedRecipe } = store.get();
    // A recipe selection owns the highlight; suppress single-ingredient neighbors
    // so a stale `selected` can't bleed a neighbor fan into the constellation.
    if (selected == null || selectedRecipe != null) {
      neighborSet = new Set();
      neighborList = [];
      return;
    }
    neighborList = engine.neighbors(selected, model, neighborK).map((n) => n.index);
    neighborSet = new Set(neighborList);
  }

  function recomputeRecipe(): void {
    const { selectedRecipe } = store.get();
    recipeList = selectedRecipe ? selectedRecipe.nodeIndices : [];
    recipeSet = new Set(recipeList);
  }

  function fillColor(i: number): RGBA {
    const { selected, hovered, colorBy, selectedRecipe } = store.get();
    const li = engine.labelIndex(colorBy, i);
    const [r, g, b] = familyRgb(engine.legend(colorBy)[li], li);
    if (i === hovered) return [255, 255, 255, 255];
    if (selectedRecipe) return recipeSet.has(i) ? [r, g, b, 255] : [r, g, b, DIM_ALPHA];
    if (selected == null) return [r, g, b, BASE_ALPHA];
    if (i === selected) return [r, g, b, 255];
    if (neighborSet.has(i)) return [r, g, b, 255];
    return [r, g, b, DIM_ALPHA];
  }

  // Radii are in screen pixels so points stay crisp and constant-size at any zoom.
  function radius(i: number): number {
    const { selected, hovered, selectedRecipe } = store.get();
    if (i === hovered) return 6;
    if (selectedRecipe) return recipeSet.has(i) ? 4.5 : 2;
    if (i === selected) return 7;
    if (selected != null && neighborSet.has(i)) return 4.5;
    return selected == null ? 2.6 : 2;
  }

  // Only the selected and hovered points are labeled, to avoid a pile-up in dense
  // clusters. Neighbor names live in the side panel and light up on hover.
  function labelData(): number[] {
    const { selected, hovered } = store.get();
    const ids = new Set<number>();
    if (selected != null) ids.add(selected);
    if (hovered != null) ids.add(hovered);
    return [...ids];
  }

  // --- Hover preview card (name + thumbnail near the cursor) ---
  const card = document.createElement('div');
  card.className = 'hover-card';
  card.hidden = true;
  const cardThumb = document.createElement('div');
  cardThumb.className = 'hover-thumb';
  const cardPh = document.createElement('div');
  cardPh.className = 'hover-thumb-ph';
  const cardImg = document.createElement('img');
  cardImg.className = 'hover-thumb-img';
  cardThumb.append(cardPh, cardImg);
  const cardName = document.createElement('span');
  cardName.className = 'hover-name';
  card.append(cardThumb, cardName);
  (container.parentElement ?? container).append(card);

  let cardIndex = -1;
  let dwell: number | null = null;

  function setCardImage(url: string, forIndex: number): void {
    cardImg.onload = () => {
      if (cardIndex === forIndex) cardThumb.classList.add('has-img');
    };
    cardImg.src = url;
  }

  function showCard(index: number, x: number, y: number): void {
    card.hidden = false;
    const w = card.offsetWidth || 180;
    const h = card.offsetHeight || 56;
    const maxX = container.clientWidth;
    const maxY = container.clientHeight;
    const left = x + 18 + w > maxX ? x - w - 18 : x + 18;
    const top = y + 18 + h > maxY ? y - h - 18 : y + 18;
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${Math.max(8, top)}px`;
    if (index === cardIndex) return;
    cardIndex = index;
    if (dwell != null) clearTimeout(dwell);

    const name = engine.name(index);
    cardName.textContent = pretty(name);
    cardThumb.classList.remove('has-img');
    cardImg.removeAttribute('src');
    cardPh.textContent = pretty(name).charAt(0).toUpperCase();

    const peeked = peekImage(name);
    if (peeked) {
      setCardImage(peeked.url, index);
    } else if (peeked === undefined) {
      // Unknown: wait for a short dwell before fetching, to avoid spamming
      // requests while the pointer sweeps across the cloud.
      dwell = window.setTimeout(() => {
        resolveImage(name).then((res) => {
          if (cardIndex === index && res) setCardImage(res.url, index);
        });
      }, 280);
    }
  }

  function hideCard(): void {
    card.hidden = true;
    cardIndex = -1;
    if (dwell != null) {
      clearTimeout(dwell);
      dwell = null;
    }
  }

  // Center of mass of the recipe's stars; the constellation edges fan out from
  // here. Reads the same tweened `coords` as the points, so it glides in lockstep.
  function recipeCentroid(): [number, number] {
    if (!recipeList.length) return [0, 0];
    let sx = 0;
    let sy = 0;
    for (const i of recipeList) {
      const [x, y] = pos(i);
      sx += x;
      sy += y;
    }
    return [sx / recipeList.length, sy / recipeList.length];
  }

  function buildLayers() {
    const { selected, model, colorBy, hovered, selectedRecipe } = store.get();
    const recipeKey = selectedRecipe ? selectedRecipe.id : '∅';
    const trigger = `${colorBy}|${selected}|${hovered}|${model}|${recipeKey}`;
    const showSelection = selected != null && selectedRecipe == null;

    const scatter = new ScatterplotLayer<number>({
      id: 'points',
      data,
      getPosition: pos,
      getFillColor: fillColor,
      getRadius: radius,
      radiusUnits: 'pixels',
      antialiasing: true,
      stroked: true,
      getLineColor: (i: number) =>
        showSelection && i === selected ? [255, 255, 255, 255] : [255, 255, 255, 0],
      getLineWidth: (i: number) => (showSelection && i === selected ? 1.5 : 0),
      lineWidthUnits: 'pixels',
      pickable: true,
      autoHighlight: false,
      onHover: (info) => {
        const idx = info.index >= 0 ? info.index : null;
        store.set({ hovered: idx });
        if (idx == null) hideCard();
        else showCard(idx, info.x, info.y);
      },
      onClick: (info) => {
        if (info.index >= 0) pickIngredient(store, info.index);
      },
      updateTriggers: {
        getPosition: frame,
        getFillColor: trigger,
        getRadius: trigger,
        getLineColor: trigger,
        getLineWidth: trigger,
      },
    });

    const links =
      showSelection
        ? new LineLayer<number>({
            id: 'links',
            data: neighborList,
            getSourcePosition: () => pos(selected),
            getTargetPosition: (i: number) => pos(i),
            getColor: [255, 255, 255, 70],
            getWidth: 1,
            updateTriggers: { getSourcePosition: `${selected}|${frame}`, getTargetPosition: frame },
          })
        : null;

    // The recipe constellation: accent-orange edges from the centroid to each
    // ingredient star, distinct from the white neighbor fan.
    const recipeLinks = selectedRecipe
      ? new LineLayer<number>({
          id: 'recipe-links',
          data: recipeList,
          getSourcePosition: () => recipeCentroid(),
          getTargetPosition: (i: number) => pos(i),
          getColor: [255, 180, 84, 150],
          getWidth: 1.2,
          updateTriggers: { getSourcePosition: `${recipeKey}|${frame}`, getTargetPosition: frame },
        })
      : null;

    const labels = new TextLayer<number>({
      id: 'labels',
      data: labelData(),
      getPosition: pos,
      getText: (i: number) => pretty(engine.name(i)),
      getColor: [240, 240, 245, 255],
      getSize: (i: number) => (i === selected ? 15 : 12),
      sizeUnits: 'pixels',
      getPixelOffset: [0, -14],
      fontFamily: 'Inter, system-ui, sans-serif',
      fontWeight: 600,
      outlineColor: [8, 10, 18, 255],
      outlineWidth: 3,
      fontSettings: { sdf: true },
      background: false,
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'bottom',
      updateTriggers: { getPosition: frame, getSize: selected },
    });

    return [scatter, links, recipeLinks, labels].filter(Boolean);
  }

  // We drive the view state ourselves (controlled mode) so selecting a star can
  // smoothly fly the camera to it while the controller still handles pan/zoom.
  const easeInOut = (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  let viewState: { target: [number, number, number]; zoom: number; minZoom: number; maxZoom: number } = {
    target: [0, 0, 0],
    zoom: 1.6,
    minZoom: -2,
    maxZoom: 8,
  };
  let camRaf: number | null = null;

  const deck = new Deck({
    parent: container,
    views: new OrthographicView({ flipY: false }),
    viewState,
    controller: { dragRotate: false, doubleClickZoom: true },
    onViewStateChange: ({ viewState: next }) => {
      // A controller-driven change (drag, scroll, double-click) means the user is
      // taking over, so abandon any in-flight fly-to. Programmatic updates go
      // through setProps and never reach here, so this won't cancel our own fly.
      if (camRaf != null) {
        cancelAnimationFrame(camRaf);
        camRaf = null;
      }
      viewState = next as typeof viewState;
      deck.setProps({ viewState });
    },
    style: { position: 'absolute', inset: '0' },
    getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
    layers: buildLayers(),
  });

  // Ease the camera from wherever it is now into (tx, ty) at zoom tz. Instead of
  // linearly interpolating world target + zoom (which makes the view swing across
  // the map), we pin the destination point in screen space and let it glide to
  // center as the zoom ramps - so it reads as zooming *into* the point from the
  // current view. Derivation: keep the point's pixel offset from center easing to
  // zero, i.e. target(t) = S - (S - T0) * (1 - e) * 2^(z0 - z(t)).
  function flyTo(tx: number, ty: number, tz: number): void {
    const x0 = viewState.target[0];
    const y0 = viewState.target[1];
    const z0 = viewState.zoom;
    const start = performance.now();
    const duration = 650;
    if (camRaf != null) cancelAnimationFrame(camRaf);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      const z = z0 + (tz - z0) * e;
      const f = (1 - e) * Math.pow(2, z0 - z);
      viewState = {
        ...viewState,
        target: [tx - (tx - x0) * f, ty - (ty - y0) * f, 0] as [number, number, number],
        zoom: z,
      };
      deck.setProps({ viewState });
      camRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    camRaf = requestAnimationFrame(tick);
  }

  // Frame the chosen star dead center, zoomed in just enough to show its lit-up
  // neighbors. We bias toward a firm close-up rather than fitting the (often
  // far-flung) UMAP neighbors, which previously clamped to a barely-perceptible
  // zoom. Always zoom in relative to the current view.
  function focusOn(index: number): void {
    const [sx, sy] = pos(index);
    const zoom = Math.min(6, Math.max(4.3, viewState.zoom + 1.4));
    flyTo(sx, sy, zoom);
  }

  // Straight-line camera ease (target and zoom interpolated directly). Unlike
  // flyTo, this works for zooming *out* too, so every intermediate frame stays
  // between the start and end view instead of swinging off-screen - which is
  // essential when fitting a spread-out recipe constellation.
  function flyToFit(tx: number, ty: number, tz: number): void {
    const x0 = viewState.target[0];
    const y0 = viewState.target[1];
    const z0 = viewState.zoom;
    const start = performance.now();
    const duration = 650;
    if (camRaf != null) cancelAnimationFrame(camRaf);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = easeInOut(t);
      viewState = {
        ...viewState,
        target: [x0 + (tx - x0) * e, y0 + (ty - y0) * e, 0] as [number, number, number],
        zoom: z0 + (tz - z0) * e,
      };
      deck.setProps({ viewState });
      camRaf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    camRaf = requestAnimationFrame(tick);
  }

  // Frame a whole set of stars (a recipe's constellation): center on their
  // bounding box and pick a zoom that fits it into the viewport, leaving room
  // for the side panel that overlays the left edge of the canvas.
  const PANEL_PX = 360; // approximate width of the spine overlay

  function focusOnSet(indices: number[]): void {
    if (!indices.length) return;
    if (indices.length === 1) return focusOn(indices[0]);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const i of indices) {
      const [x, y] = pos(i);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const spanX = Math.max(maxX - minX, 1e-3);
    const spanY = Math.max(maxY - minY, 1e-3);
    // Orthographic deck.gl: world units per pixel = 1 / 2^zoom. Fit the span into
    // the canvas area not covered by the panel, with margin.
    const usableW = Math.max(120, container.clientWidth - PANEL_PX) * 0.82;
    const usableH = container.clientHeight * 0.82;
    const rawZoom = Math.log2(Math.min(usableW / spanX, usableH / spanY));
    // Clamp so a far-flung constellation never shrinks the map to nothing and a
    // tight one never slams to max zoom.
    const zoom = Math.max(1.2, Math.min(5.5, rawZoom));
    // Shift the world target left so the centroid sits in the visible area to
    // the right of the panel rather than under it.
    const worldPerPx = 1 / Math.pow(2, zoom);
    const tx = cx - (PANEL_PX / 2) * worldPerPx;
    flyToFit(tx, cy, zoom);
  }

  function update(): void {
    deck.setProps({ layers: buildLayers() });
  }

  // Tween every point from its current position to the target model's layout.
  // All layers read `coords`, so the cloud, links and labels move together.
  function animateTo(model: string): void {
    const from = Float32Array.from(coords);
    const to = engine.layout(model);
    const start = performance.now();
    const duration = 850;
    const ease = (t: number) => t * t * (3 - 2 * t);
    if (raf != null) cancelAnimationFrame(raf);
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      for (let i = 0; i < to.length; i++) coords[i] = from[i] + (to[i] - from[i]) * e;
      frame++;
      update();
      raf = t < 1 ? requestAnimationFrame(tick) : null;
    };
    raf = requestAnimationFrame(tick);
  }

  store.subscribe((_, changed) => {
    if (changed.has('selected') || changed.has('model') || changed.has('selectedRecipe')) {
      recomputeNeighbors();
    }
    if (changed.has('selectedRecipe')) {
      recomputeRecipe();
      const { selectedRecipe } = store.get();
      if (selectedRecipe) focusOnSet(selectedRecipe.nodeIndices);
    }
    if (changed.has('selected')) {
      const { selected } = store.get();
      if (selected != null) focusOn(selected);
    }
    if (changed.has('model')) animateTo(store.get().model);
    else update();
  });

  recomputeNeighbors();
  recomputeRecipe();
  update();
}
