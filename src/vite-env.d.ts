/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Base origin of the recipe search API (e.g. https://flavor-galaxy-api.fly.dev).
  // Unset in dev -> falls back to the local server in src/recipes.ts.
  readonly VITE_RECIPE_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
