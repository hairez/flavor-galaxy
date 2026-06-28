// Unit tests for the ingredient mapping cascade. Run: node --test scripts/lib
// These guard the single most correctness-critical piece of the recipe pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeTerm,
  stripPrepAdjectives,
  stripQuantityUnit,
  stripTrailingDescriptors,
  singularizeToken,
  singularCandidates,
  headNounCandidates,
  withinEditDistance1,
  createMapper,
} from './normalize.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const meta = JSON.parse(readFileSync(join(root, 'public/data/meta.json'), 'utf8'));
const aliasFile = JSON.parse(readFileSync(join(root, 'scripts/aliases.json'), 'utf8'));
const mapper = createMapper(meta.names, aliasFile.aliases);
const map = (t) => mapper.mapTerm(t).name;

test('normalizeTerm: accents, case, spaces, punctuation', () => {
  assert.equal(normalizeTerm('Crème Fraîche'), 'creme_fraiche');
  assert.equal(normalizeTerm('  Green Onion '), 'green_onion');
  assert.equal(normalizeTerm('1 cup, flour!'), '1_cup_flour');
});

test('normalizeTerm: falsy input and separator collapse', () => {
  assert.equal(normalizeTerm(''), '');
  assert.equal(normalizeTerm(null), '');
  assert.equal(normalizeTerm(undefined), '');
  assert.equal(normalizeTerm('extra-virgin olive-oil'), 'extra_virgin_olive_oil');
  assert.equal(normalizeTerm('flour___sugar'), 'flour_sugar');
});

test('stripPrepAdjectives drops leading prep words only', () => {
  assert.equal(stripPrepAdjectives('fresh_basil'), 'basil');
  assert.equal(stripPrepAdjectives('finely_chopped_onion'), 'onion');
  assert.equal(stripPrepAdjectives('olive_oil'), 'olive_oil');
});

test('stripQuantityUnit drops leading numbers, units, and "of"', () => {
  assert.equal(stripQuantityUnit('1_cup_all_purpose_flour'), 'all_purpose_flour');
  assert.equal(stripQuantityUnit('1_2_cup_flour'), 'flour'); // "1/2 cup" -> "1_2_cup"
  assert.equal(stripQuantityUnit('2_cloves_garlic'), 'garlic');
  assert.equal(stripQuantityUnit('1_can_of_tomatoes'), 'tomatoes');
  assert.equal(stripQuantityUnit('500g_chicken'), 'chicken'); // digit-prefixed unit token
  assert.equal(stripQuantityUnit('3_large_eggs'), 'large_eggs'); // stops at non-unit
  assert.equal(stripQuantityUnit('flour'), 'flour'); // never empties
  assert.equal(stripQuantityUnit('olive_oil'), 'olive_oil'); // no quantity to strip
});

test('stripTrailingDescriptors drops trailing descriptors and connectors', () => {
  assert.equal(stripTrailingDescriptors('garlic_minced'), 'garlic');
  assert.equal(stripTrailingDescriptors('parsley_finely_chopped'), 'parsley');
  assert.equal(stripTrailingDescriptors('salt_to_taste'), 'salt');
  assert.equal(stripTrailingDescriptors('butter_softened_divided'), 'butter');
  assert.equal(stripTrailingDescriptors('olive_oil'), 'olive_oil'); // nothing trailing
  assert.equal(stripTrailingDescriptors('chopped'), 'chopped'); // never empties
});

test('singularizeToken common rules', () => {
  assert.equal(singularizeToken('eggs'), 'egg');
  assert.equal(singularizeToken('tomatoes'), 'tomato');
  assert.equal(singularizeToken('berries'), 'berry');
  assert.equal(singularizeToken('leaves'), 'leaf');
});

test('singularizeToken: -sses/-shes/-ches, the -ss guard, and no-rule fall-through', () => {
  assert.equal(singularizeToken('glasses'), 'glass'); // -sses
  assert.equal(singularizeToken('dishes'), 'dish'); // -shes
  assert.equal(singularizeToken('peaches'), 'peach'); // -ches
  assert.equal(singularizeToken('watercress'), 'watercress'); // -ss guard: must NOT strip
  assert.equal(singularizeToken('bus'), 'bus'); // length <= 3 short-circuit
  assert.equal(singularizeToken('oil'), 'oil'); // no suffix rule applies
});

test('withinEditDistance1: substitution, transposition, and rejections', () => {
  assert.ok(withinEditDistance1('brocoli', 'broccoli')); // insertion
  assert.ok(withinEditDistance1('tomatoe', 'tomato')); // deletion
  assert.ok(withinEditDistance1('cat', 'cat')); // identical (a === b fast path)
  assert.ok(withinEditDistance1('cat', 'cap')); // single substitution (equal length)
  assert.ok(withinEditDistance1('form', 'from')); // adjacent transposition
  assert.ok(!withinEditDistance1('abcd', 'badc')); // two non-adjacent swaps
  assert.ok(!withinEditDistance1('cat', 'dog')); // too many diffs
  assert.ok(!withinEditDistance1('red_wine', 'white_wine'));
});

test('singularCandidates excludes the original and singularizes whole + head', () => {
  // whole-key and head-token singularization both yield green_onion; the input
  // itself is excluded so the cascade only tests genuinely new candidates.
  assert.deepEqual(singularCandidates('green_onions'), ['green_onion']);
  assert.deepEqual(singularCandidates('eggs'), ['egg']);
});

test('headNounCandidates yields trailing sub-phrases longest-first', () => {
  assert.deepEqual(headNounCandidates('smoked_streaky_bacon'), ['streaky_bacon', 'bacon']);
  assert.deepEqual(headNounCandidates('bacon'), []);
});

test('exact match', () => {
  assert.equal(map('chicken'), 'chicken');
  assert.equal(map('olive oil'), 'olive_oil');
});

test('alias match (British/synonym/cheese)', () => {
  assert.equal(map('green onion'), 'scallion');
  assert.equal(map('cilantro'), 'coriander');
  assert.equal(map('aubergine'), 'eggplant');
  assert.equal(map('courgette'), 'zucchini');
  assert.equal(map('parmesan'), 'parmesan_cheese');
  assert.equal(map('mozzarella'), 'mozzarella_cheese');
});

test('plural normalization', () => {
  assert.equal(map('eggs'), 'egg');
  assert.equal(map('tomatoes'), 'tomato');
  assert.equal(map('carrots'), 'carrot');
});

test('prep-adjective stripping reaches the canonical', () => {
  assert.equal(map('fresh basil'), 'basil');
  assert.equal(map('minced garlic'), 'garlic');
  assert.equal(map('boneless chicken'), 'chicken');
});

test('raw quantity-bearing ingredient lines map to the canonical', () => {
  assert.equal(map('3 large eggs'), 'egg');
  assert.equal(map('1 cup all-purpose flour'), 'flour');
  assert.equal(map('2 cloves garlic, minced'), 'garlic');
  assert.equal(map('1 can diced tomatoes'), 'tomato');
  assert.equal(map('1/2 cup heavy cream'), 'cream');
  assert.equal(map('salt to taste'), 'salt');
  assert.equal(map('2 tablespoons olive oil'), 'olive_oil');
});

test('head_noun stage singularizes the trailing sub-phrase', () => {
  // only the bare singular "onion" is canonical here, so "pearl onions" must
  // reach it by singularizing the head-noun candidate "onions".
  const m = createMapper(['onion'], {});
  const r = m.mapTerm('pearl onions');
  assert.equal(r.name, 'onion');
  assert.equal(r.via, 'head_noun');
});

test('expanded aliases: British forms and synonyms resolve', () => {
  assert.equal(map('cornflour'), 'cornstarch');
  assert.equal(map('caster sugar'), 'sugar');
  assert.equal(map('icing sugar'), 'sugar');
  assert.equal(map('bicarbonate of soda'), 'baking_soda');
  assert.equal(map('sea salt'), 'salt');
  assert.equal(map('vanilla extract'), 'vanilla');
  assert.equal(map('chicken breast'), 'chicken');
  assert.equal(map('boneless skinless chicken breasts'), 'chicken');
  assert.equal(map('streaky bacon'), 'bacon');
  assert.equal(map('chicken stock'), 'chicken_broth');
});

test('inherently-plural canonicals survive (exact wins before singularize)', () => {
  // these only pass if such names exist; assert they are not mis-singularized
  if (meta.names.includes('baked_beans')) assert.equal(map('baked beans'), 'baked_beans');
});

test('head_noun stage resolves a multi-word term to its trailing canonical', () => {
  // 'smoked'/'streaky' aren't prep words, so this only resolves via the head-noun
  // stage (stage 5), distinct from exact/alias/plural. Asserting `via` pins that.
  const m = createMapper(['bacon'], {});
  const r = m.mapTerm('smoked streaky bacon');
  assert.equal(r.name, 'bacon');
  assert.equal(r.via, 'head_noun');
});

test('fuzzy stage corrects a typo within edit distance 1', () => {
  const m = createMapper(['broccoli'], {});
  const r = m.mapTerm('brocoli');
  assert.equal(r.name, 'broccoli');
  assert.equal(r.via, 'fuzzy');
});

test('fuzzy gating: length < 5 and first-letter typos do not fuzzy-match', () => {
  const m = createMapper(['broccoli'], {});
  assert.equal(m.mapTerm('eg').via, 'unmatched'); // too short to fuzzy
  assert.equal(m.mapTerm('vroccoli').via, 'unmatched'); // first-letter bucket misses
});

test('alias resolves after singularization (stage 4 alias path)', () => {
  // The alias key is singular only; a plural input must singularize first, then
  // hit the alias - exercising the alias branch inside the singular/plural stage.
  const m = createMapper(['scallion'], { spring_onion: 'scallion' });
  const r = m.mapTerm('spring onions');
  assert.equal(r.name, 'scallion');
  assert.equal(r.via, 'alias');
});

test('unmatched returns null', () => {
  assert.equal(map('unicorn tears'), null);
  assert.equal(mapper.mapTerm('xyzzy123').via, 'unmatched');
});

test('empty / unnormalizable terms map via "empty" and are excluded from unmapped', () => {
  assert.equal(mapper.mapTerm('').via, 'empty');
  assert.equal(mapper.mapTerm('!!!').via, 'empty');
  // mapRecipe drops empty terms but still records a genuine miss.
  const { unmapped } = mapper.mapRecipe(['', '!!!', 'unicorn tears']);
  assert.deepEqual(unmapped, ['unicorn tears']);
});

test('mapRecipe.mappedCount counts mapped terms before dedup', () => {
  // Two distinct terms resolving to the same node count twice toward coverage but
  // collapse to one node index.
  const m = createMapper(['parmesan_cheese'], { parmesan: 'parmesan_cheese' });
  const { nodeIndices, mappedCount } = m.mapRecipe(['parmesan', 'parmesan cheese']);
  assert.deepEqual(nodeIndices, [0]);
  assert.equal(mappedCount, 2);
});

test('alias table has no invalid targets', () => {
  assert.deepEqual(mapper.invalidAliases, []);
});

test('invalid aliases are recorded and dropped from the live mapping', () => {
  const m = createMapper(['scallion'], { good: 'scallion', bad: 'nonexistent' });
  assert.deepEqual(m.invalidAliases, [{ alias: 'bad', target: 'nonexistent' }]);
  assert.equal(m.mapTerm('good').name, 'scallion'); // valid alias still works
  assert.equal(m.mapTerm('bad').via, 'unmatched'); // invalid alias was not applied
});

test('mapRecipe dedupes and sorts node indices', () => {
  const { nodeIndices, unmapped } = mapper.mapRecipe([
    'chicken', 'Chicken', 'onion', 'garlic', 'unicorn tears',
  ]);
  assert.ok(nodeIndices.length === 3, 'three unique mapped ingredients');
  assert.deepEqual(nodeIndices, [...nodeIndices].sort((a, b) => a - b));
  assert.deepEqual(unmapped, ['unicorn tears']);
});
