// The galaxy: a WebGL scatter of all 1,790 ingredients laid out by UMAP. Points
// keep their (food-group / aroma / taste) color across all three models, so when
// you switch models the whole cloud re-forms and you can watch where a category
// drifts. Selecting an ingredient draws its constellation of nearest neighbors.

import { Deck, OrthographicView } from '@deck.gl/core';
import { ScatterplotLayer, LineLayer, TextLayer } from '@deck.gl/layers';
import { Engine, pretty } from '../engine';
import { Store } from '../state';
import { familyRgb } from '../config';

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

  const pos = (i: number): [number, number] => [coords[i * 2], coords[i * 2 + 1]];

  function recomputeNeighbors(): void {
    const { selected, model, neighborK } = store.get();
    if (selected == null) {
      neighborSet = new Set();
      neighborList = [];
      return;
    }
    neighborList = engine.neighbors(selected, model, neighborK).map((n) => n.index);
    neighborSet = new Set(neighborList);
  }

  function fillColor(i: number): RGBA {
    const { selected, hovered, colorBy } = store.get();
    const li = engine.labelIndex(colorBy, i);
    const [r, g, b] = familyRgb(engine.legend(colorBy)[li], li);
    if (i === hovered) return [255, 255, 255, 255];
    if (selected == null) return [r, g, b, BASE_ALPHA];
    if (i === selected) return [r, g, b, 255];
    if (neighborSet.has(i)) return [r, g, b, 255];
    return [r, g, b, DIM_ALPHA];
  }

  // Radii are in screen pixels so points stay crisp and constant-size at any zoom.
  function radius(i: number): number {
    const { selected, hovered } = store.get();
    if (i === hovered) return 6;
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

  function buildLayers() {
    const { selected, model, colorBy, hovered } = store.get();
    const trigger = `${colorBy}|${selected}|${hovered}|${model}`;

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
        i === selected ? [255, 255, 255, 255] : [255, 255, 255, 0],
      getLineWidth: (i: number) => (i === selected ? 1.5 : 0),
      lineWidthUnits: 'pixels',
      pickable: true,
      autoHighlight: false,
      onHover: (info) => {
        store.set({ hovered: info.index >= 0 ? info.index : null });
      },
      onClick: (info) => {
        if (info.index >= 0) store.set({ selected: info.index });
      },
      updateTriggers: {
        getPosition: frame,
        getFillColor: trigger,
        getRadius: trigger,
        getLineColor: selected,
        getLineWidth: selected,
      },
    });

    const links =
      selected != null
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

    return [scatter, links, labels].filter(Boolean);
  }

  const deck = new Deck({
    parent: container,
    views: new OrthographicView({ flipY: false }),
    initialViewState: { target: [0, 0, 0], zoom: 1.6, minZoom: -2, maxZoom: 8 },
    controller: { dragRotate: false, doubleClickZoom: true },
    style: { position: 'absolute', inset: '0' },
    getCursor: ({ isHovering }) => (isHovering ? 'pointer' : 'grab'),
    layers: buildLayers(),
  });

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
    if (changed.has('selected') || changed.has('model')) recomputeNeighbors();
    if (changed.has('model')) animateTo(store.get().model);
    else update();
  });

  recomputeNeighbors();
  update();
}
