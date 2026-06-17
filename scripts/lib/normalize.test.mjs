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
  singularizeToken,
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

test('stripPrepAdjectives drops leading prep words only', () => {
  assert.equal(stripPrepAdjectives('fresh_basil'), 'basil');
  assert.equal(stripPrepAdjectives('finely_chopped_onion'), 'onion');
  assert.equal(stripPrepAdjectives('olive_oil'), 'olive_oil');
});

test('singularizeToken common rules', () => {
  assert.equal(singularizeToken('eggs'), 'egg');
  assert.equal(singularizeToken('tomatoes'), 'tomato');
  assert.equal(singularizeToken('berries'), 'berry');
  assert.equal(singularizeToken('leaves'), 'leaf');
});

test('withinEditDistance1', () => {
  assert.ok(withinEditDistance1('brocoli', 'broccoli')); // insertion
  assert.ok(withinEditDistance1('tomatoe', 'tomato')); // deletion
  assert.ok(withinEditDistance1('yohgurt', 'yohgurt')); // identical
  assert.ok(!withinEditDistance1('red_wine', 'white_wine'));
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

test('inherently-plural canonicals survive (exact wins before singularize)', () => {
  // these only pass if such names exist; assert they are not mis-singularized
  if (meta.names.includes('baked_beans')) assert.equal(map('baked beans'), 'baked_beans');
});

test('unmatched returns null', () => {
  assert.equal(map('unicorn tears'), null);
  assert.equal(mapper.mapTerm('xyzzy123').via, 'unmatched');
});

test('alias table has no invalid targets', () => {
  assert.deepEqual(mapper.invalidAliases, []);
});

test('mapRecipe dedupes and sorts node indices', () => {
  const { nodeIndices, unmapped } = mapper.mapRecipe([
    'chicken', 'Chicken', 'onion', 'garlic', 'unicorn tears',
  ]);
  assert.ok(nodeIndices.length === 3, 'three unique mapped ingredients');
  assert.deepEqual(nodeIndices, [...nodeIndices].sort((a, b) => a - b));
  assert.deepEqual(unmapped, ['unicorn tears']);
});
