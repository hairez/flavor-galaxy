// Translates non-English ingredient surface forms to canonical American-English
// food nouns via Claude, so the existing mapper (scripts/lib/normalize.mjs) can
// then resolve English -> node index. This reconstructs the Epicure paper's
// "LLM-augmented" normalization for the multilingual sources.
//
// Cost control: only the frequency-cut DISTINCT forms per language are translated
// (tens of thousands total, not 4.14M recipes), and the result is committed to
// scripts/recipes/surface-map/<lang>.json so re-runs and CI never call the LLM.
//
// Uses the Anthropic Message Batches API (50% off) with structured JSON output
// and a cached system prefix. Requires ANTHROPIC_API_KEY and @anthropic-ai/sdk
// (peer dep, dynamically imported so the rest of the pipeline runs without it).

const MODEL = 'claude-opus-4-8';
const CHUNK = 200; // forms per batch request -> bounded, parseable output

const SYSTEM = `You map a food-ingredient surface form (in the given language) to the single most likely canonical American-English food noun: singular, lowercase, no quantity or unit. Examples: "鸡蛋" -> "egg", "яйцо" -> "egg", "farine" -> "flour". If the form is not a food ingredient (a quantity, a brand, water, a utensil, punctuation), return an empty string for english_canonical. Output strictly via the provided schema.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          surface_form: { type: 'string' },
          english_canonical: { type: 'string' }, // "" when not a food ingredient
        },
        required: ['surface_form', 'english_canonical'],
      },
    },
  },
  required: ['translations'],
};

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

async function loadSdk() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The LLM surface-form translation step needs it; ' +
        'run with --no-llm to skip non-English mapping, or set the key.',
    );
  }
  try {
    const mod = await import('@anthropic-ai/sdk');
    return mod.default;
  } catch {
    throw new Error(
      '@anthropic-ai/sdk is not installed. Run `npm i -D @anthropic-ai/sdk` to enable the ' +
        'LLM translation step, or run the pipeline with --no-llm.',
    );
  }
}

// Translate distinct surface forms for one language. Returns a plain object
// { surfaceForm: englishCanonical } ("" for non-food). Caller resolves English
// -> node via the shared mapper and commits the combined table.
export async function translateSurfaceForms(forms, { lang, onProgress } = {}) {
  if (!forms.length) return {};
  const Anthropic = await loadSdk();
  const client = new Anthropic();

  const chunks = chunk(forms, CHUNK);
  const batch = await client.messages.batches.create({
    requests: chunks.map((forms, i) => ({
      custom_id: `${lang}-${i}`,
      params: {
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: JSON.stringify(forms) }],
      },
    })),
  });

  // Poll until the batch finishes (most complete within an hour; max 24h).
  let status = batch;
  while (status.processing_status !== 'ended') {
    await new Promise((r) => setTimeout(r, 30_000));
    status = await client.messages.batches.retrieve(batch.id);
    onProgress?.(status.request_counts);
  }

  const table = {};
  for await (const result of await client.messages.batches.results(batch.id)) {
    if (result.result.type !== 'succeeded') continue;
    const msg = result.result.message;
    const textBlock = msg.content.find((b) => b.type === 'text');
    if (!textBlock) continue;
    let parsed;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch {
      continue; // skip a malformed chunk rather than abort the whole language
    }
    for (const t of parsed.translations ?? []) {
      if (t && typeof t.surface_form === 'string') {
        table[t.surface_form] = typeof t.english_canonical === 'string' ? t.english_canonical : '';
      }
    }
  }
  return table;
}
