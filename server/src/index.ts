// Fastify bootstrap. Selects the search backend (in-memory seed corpus by
// default, Meilisearch when MEILI_HOST is set), wires CORS for the static Pages
// frontend, and registers the recipe routes.

import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { config, useMeili } from './config.js';
import { InMemoryIndex, type SearchIndex } from './searchIndex.js';
import { registerSearch } from './routes/search.js';
import { registerRecipe } from './routes/recipe.js';
import { registerHealth } from './routes/health.js';

async function buildIndex(): Promise<SearchIndex> {
  if (useMeili) {
    const { MeiliIndex } = await import('./meili.js');
    return new MeiliIndex();
  }
  return InMemoryIndex.fromNdjsonFile(config.recipesFile);
}

// Wire CORS and the routes onto a Fastify app for a given backend, without
// listening. Exported so tests can drive the routes via app.inject().
export async function buildApp(
  index: SearchIndex,
  opts: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / curl (no Origin header) and allowlisted origins pass.
      if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'OPTIONS'],
  });

  registerSearch(app, index);
  registerRecipe(app, index);
  registerHealth(app, index);
  return app;
}

async function main(): Promise<void> {
  const index = await buildIndex();
  const app = await buildApp(index, { logger: true });

  await app.listen({ port: config.port, host: config.host });
  // A transient backend hiccup here must not kill an already-listening server.
  try {
    app.log.info(`recipe search: ${index.engine}, ${await index.count()} docs`);
  } catch (err) {
    app.log.warn({ err }, `recipe search: ${index.engine}, doc count unavailable`);
  }
}

// Only boot the server when run directly (`node dist/index.js` / tsx), not when
// imported - tests import buildApp and drive routes via inject() without listening.
const runDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (runDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
