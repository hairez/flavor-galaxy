// One-off capture of the README screenshots and movement GIFs.
//
// This is a reference/regeneration tool, NOT part of the build. It is committed
// so the README assets can be reproduced, but `playwright` is intentionally not a
// project dependency - install it ad hoc to run:
//
//   npm run dev                       # serves the app (note the port it prints)
//   npm i -D playwright               # ad hoc; do not commit this change
//   npx playwright install chromium
//   APP_URL=http://localhost:5174/flavor-galaxy/ node scripts/capture-screenshots.mjs
//   git checkout package.json package-lock.json   # drop the ad hoc dep
//
// It produces, under docs/: hero.png, color-by-aroma.png, and two raw .webm
// recordings under RAW_DIR plus a manifest.json with the trim windows, which
// scripts/ffmpeg turns into docs/recipe-models.gif and docs/ingredient-models.gif.
// No recipe backend is needed: the recipe-search response is stubbed via
// page.route with the precomputed node indices for Chicken Tikka Masala.

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const APP_URL = process.env.APP_URL || 'http://localhost:5174/flavor-galaxy/';
const HEADED = process.env.HEADED === '1';
// Optionally capture a single asset group: 'stills' | 'ingredient' | 'recipe'.
const ONLY = process.env.ONLY || '';
const OUT_DIR = 'docs';
const RAW_DIR = '/tmp/flavor-capture';
const VIEWPORT = { width: 1600, height: 1000 };

// Chicken Tikka Masala -> canonical node indices (precomputed read-only via
// scripts/lib/normalize.mjs against committed meta.json + aliases.json).
const RECIPE_NODES = [321, 412, 445, 475, 669, 679, 1122, 1157, 1644, 1778];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(RAW_DIR, { recursive: true });

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-gl=angle', '--force-color-profile=srgb'],
});

// Wait for the app to be interactive and the galaxy to have drawn a first frame.
async function waitReady(page) {
  await page.waitForSelector('input.search-input', { state: 'visible', timeout: 30000 });
  await page.waitForSelector('.galaxy-root canvas', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await sleep(1500); // let the initial WebGL layout settle
}

async function clickModel(page, id) {
  await page.click(`button.stop[data-model="${id}"]`);
}

const manifest = { stills: [], gifs: [] };

// --- Stills context (no video) ---
if (!ONLY || ONLY === 'stills') {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(APP_URL, { waitUntil: 'load' });
  await waitReady(page);

  // Hero: whole galaxy, default Core model, colored by food group.
  await page.screenshot({ path: `${OUT_DIR}/hero.png` });
  console.log('captured hero.png');

  // Color-by-aroma: recolor the cloud by aroma family.
  await page.click('button.legend-tab:has-text("Aroma")');
  await sleep(700);
  await page.screenshot({ path: `${OUT_DIR}/color-by-aroma.png` });
  console.log('captured color-by-aroma.png');

  await ctx.close();
}

// Record a model-switch loop and return { videoPath, ss, dur } for ffmpeg trim.
async function recordLoop({ label, setup, startModel, order, openHoldMs = 800, dwellMs = 1500 }) {
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: RAW_DIR, size: VIEWPORT },
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(APP_URL, { waitUntil: 'load' });
  await waitReady(page);

  await setup(page); // select the thing + frame it

  // Loop window: open on the settled selection, then glide through each model.
  const ss = (Date.now() - t0) / 1000;
  await sleep(openHoldMs);
  for (const m of order) {
    await clickModel(page, m);
    await sleep(dwellMs);
  }
  const dur = (Date.now() - t0) / 1000 - ss;

  await ctx.close();
  const videoPath = await page.video().path();
  console.log(`recorded ${label}: ${videoPath} (ss=${ss.toFixed(2)} dur=${dur.toFixed(2)})`);
  return { label, videoPath, ss, dur };
}

// --- Ingredient movement GIF (live-reproducible: no backend) ---
if (!ONLY || ONLY === 'ingredient')
  manifest.gifs.push(
    await recordLoop({
      label: 'ingredient-models',
    startModel: 'core',
    order: ['cooc', 'chem', 'core'], // sweep the spectrum, return to start
    setup: async (page) => {
      await page.fill('input.search-input', 'garlic');
      await page.waitForSelector('ul.search-results li.search-result', { timeout: 10000 });
      await page.press('input.search-input', 'Enter');
      await sleep(1600); // camera fly-to + neighbor fan
      // The selection zooms in tight; a single star relocates far between layouts,
      // so a tight follow would drift off-screen. Zoom back out to the whole cloud
      // so you watch it re-form with garlic's neighborhood staying highlighted.
      await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
      for (let i = 0; i < 5; i++) {
        await page.mouse.wheel(0, 120);
        await sleep(120);
      }
      // Park the cursor over the panel header (no point-hover, no neighbor-row
      // hover). Parking alone isn't enough: jumping the cursor straight from a
      // star onto the overlay panel never emits an onHover(null), so the hover
      // preview card would otherwise stay frozen in the middle of every frame.
      await page.mouse.move(120, 92);
      await sleep(700);
      // Dismiss the card directly - nothing re-hovers a star during the loop
      // (model switches are clicks on panel buttons, never over the canvas).
      await page.evaluate(() => {
        const c = document.querySelector('.hover-card');
        if (c) c.hidden = true;
      });
    },
  }),
);

// --- Recipe constellation GIF (stubbed recipe search; chem-framed) ---
if (!ONLY || ONLY === 'recipe')
  manifest.gifs.push(
    await recordLoop({
      label: 'recipe-models',
    startModel: 'chem',
    order: ['core', 'cooc', 'chem'], // framed on chem (widest), return to chem
    setup: async (page) => {
      // Stub the recipe-search backend with the precomputed constellation.
      await page.route('**/api/recipes/search**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({
            query: 'chicken tikka masala',
            total: 1,
            hits: [{ id: 'tikka', title: 'Chicken Tikka Masala', nodes: RECIPE_NODES }],
          }),
        }),
      );
      // Frame the widest layout BEFORE selecting so focusOnSet fits it and the
      // constellation stays on screen across the whole loop.
      await clickModel(page, 'chem');
      await sleep(1200);
      await page.click('button.search-mode:has-text("Recipes")');
      await page.fill('input.search-input', 'Chicken Tikka Masala');
      await page.waitForSelector('ul.search-results li.search-result:not(.disabled)', { timeout: 10000 });
      await page.press('input.search-input', 'Enter');
      await sleep(1900); // constellation forms + camera frames
    },
  }),
);

writeFileSync(`${RAW_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log('manifest written to', `${RAW_DIR}/manifest.json`);

await browser.close();
console.log('done');
