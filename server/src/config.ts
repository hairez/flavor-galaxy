// Environment configuration. Defaults are tuned for local "just run it"
// development: no Meilisearch required, the in-memory index loads the seed
// corpus. Set MEILI_HOST to switch to the production Meilisearch backend.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(here, '..');

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '127.0.0.1',

  // When set, the server fronts a Meilisearch instance instead of the in-memory
  // index. Leave unset for local development.
  meiliHost: process.env.MEILI_HOST,
  meiliKey: process.env.MEILI_KEY,
  meiliIndex: process.env.MEILI_INDEX ?? 'recipes',

  // The in-memory backend loads this newline-delimited JSON artifact (one
  // RecipeDoc per line), produced by `npm run seed` / the recipe pipeline.
  recipesFile: process.env.RECIPES_FILE ?? join(serverRoot, 'data', 'recipes.ndjson'),

  // CORS allowlist: the static Pages origin plus local Vite dev servers.
  allowedOrigins: (process.env.ALLOWED_ORIGINS ??
    'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export const useMeili = Boolean(config.meiliHost);
