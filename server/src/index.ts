// Fastify bootstrap. Selects the search backend (in-memory seed corpus by
// default, Meilisearch when MEILI_HOST is set), wires CORS for the static Pages
// frontend, and registers the recipe routes.

import Fastify from 'fastify';
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

async function main(): Promise<void> {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / curl (no Origin header) and allowlisted origins pass.
      if (!origin || config.allowedOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    methods: ['GET', 'OPTIONS'],
  });

  const index = await buildIndex();
  registerSearch(app, index);
  registerRecipe(app, index);
  registerHealth(app, index);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`recipe search: ${index.engine}, ${await index.count()} docs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
