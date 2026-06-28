// The common intermediate representation every source adapter yields, so the
// rest of the pipeline (extraction, mapping, dedup, emit) is source- and
// language-agnostic. Adapters are async generators of IntermediateRecipe.
//
// IntermediateRecipe = {
//   title: string,                  // recipe title (any language)
//   ingredientStrings: string[],    // ingredient surface forms (NER tags when
//                                   // available, else raw ingredient lines)
//   lang: string,                   // ISO-ish language code: 'en','zh','ru',...
//   source: string,                 // source id, e.g. 'recipenlg'
//   sourceId: string,               // stable per-source record id
// }

// Validate/normalize one IR record; returns null if it is unusable (no title or
// no ingredient strings), so the orchestrator can drop it and count the skip.
export function normalizeIR(rec) {
  if (!rec || typeof rec.title !== 'string') return null;
  const title = rec.title.trim();
  if (!title) return null;
  const ingredientStrings = Array.isArray(rec.ingredientStrings)
    ? rec.ingredientStrings.map((s) => String(s).trim()).filter(Boolean)
    : [];
  if (!ingredientStrings.length) return null;
  return {
    title,
    ingredientStrings,
    lang: rec.lang || 'en',
    source: rec.source || 'unknown',
    sourceId: String(rec.sourceId ?? ''),
  };
}
