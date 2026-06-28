// RecipeNLG adapter (English, ~2.23M recipes). Streams the dataset CSV and uses
// its pre-extracted `NER` column - a JSON array of cleaned food-entity names per
// recipe (quantities/units already stripped) - as the ingredient surface forms.
// Those are exactly the pre-cleaned single-food terms the shared mapper handles
// well, so the English path needs no LLM. Falls back to the raw `ingredients`
// column when NER is missing/empty.
//
// Expected columns (RecipeNLG full_dataset.csv): index,title,ingredients,
// directions,link,source,NER. Obtain the CSV per the dataset's license (see
// scripts/recipes/sources.config.mjs).

import { createReadStream } from 'node:fs';
import { readCsvRows } from './csv.mjs';

function parseJsonArray(cell) {
  if (!cell) return [];
  try {
    const v = JSON.parse(cell);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

export async function* recipenlg({ path, limit = Infinity }) {
  const stream = createReadStream(path, 'utf8');
  let header = null;
  let col = {};
  let n = 0;
  for await (const row of readCsvRows(stream)) {
    if (!header) {
      header = row.map((h) => h.trim().toLowerCase());
      col = {
        title: header.indexOf('title'),
        ner: header.indexOf('ner'),
        ingredients: header.indexOf('ingredients'),
        index: header.indexOf(''), // the unnamed leading index column
      };
      if (col.title < 0) throw new Error('recipenlg: no "title" column in CSV header');
      continue;
    }
    if (n >= limit) break;
    const title = row[col.title] ?? '';
    let forms = col.ner >= 0 ? parseJsonArray(row[col.ner]) : [];
    if (!forms.length && col.ingredients >= 0) forms = parseJsonArray(row[col.ingredients]);
    yield {
      title,
      ingredientStrings: forms,
      lang: 'en',
      source: 'recipenlg',
      sourceId: col.index >= 0 && row[col.index] ? row[col.index] : String(n),
    };
    n++;
  }
}
