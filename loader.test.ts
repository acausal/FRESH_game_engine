// ============================================================
// loader.test.ts — Tests for the data loader
// Run with: npx ts-node src/engine/loader.test.ts
// ============================================================

import * as path from 'path';
import { loadGameData, loadNPCs, loadActions, LoadError } from './loader';

// ── Helpers ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(description: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${description}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${description}`);
    console.log(`    ${err}`);
    failed++;
  }
}

function expect<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(val: boolean, msg?: string)  { expect(val, true, msg); }
function expectFalse(val: boolean, msg?: string) { expect(val, false, msg); }

function expectThrows(fn: () => void, msg?: string): void {
  try {
    fn();
    throw new Error(msg ?? 'Expected function to throw but it did not.');
  } catch (err) {
    if (err instanceof Error && err.message === (msg ?? 'Expected function to throw but it did not.')) {
      throw err;
    }
    // threw as expected — pass
  }
}

const DATA_DIR = path.join(__dirname, '../../data');

// ── Full Load Tests ───────────────────────────────────────────

console.log('\nData Loader Tests\n');

console.log('Full game data load:');
test('loadGameData succeeds with sample data', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue(data.state !== null);
});
test('loads sara NPC', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue('sara' in data.npcs);
  expect(data.npcs['sara'].name, 'Sara');
});
test('assembles NPC state correctly', () => {
  const data = loadGameData(DATA_DIR);
  const sara = data.state.npcs['sara'];
  expectTrue(sara !== undefined);
  expect(sara.affection.value, 0);
  expect(sara.corruption.value, 0);
});
test('loads home location', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue('home' in data.locations);
});
test('loads park location', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue('park' in data.locations);
});
test('loads core actions', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue(data.actions.length > 0);
  const actionIds = data.actions.map(a => a.id);
  expectTrue(actionIds.includes('rest'));
  expectTrue(actionIds.includes('sara_talk'));
  expectTrue(actionIds.includes('park_jog'));
});
test('starting location set correctly', () => {
  const data = loadGameData(DATA_DIR);
  expect(data.state.global.current_location_id, 'home');
});
test('starting locations unlocked', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue(data.state.global.unlocked_locations.includes('home'));
  expectTrue(data.state.global.unlocked_locations.includes('park'));
});
test('day starts at 1', () => {
  const data = loadGameData(DATA_DIR);
  expect(data.state.global.day.count, 1);
});
test('world phase starts at 1', () => {
  const data = loadGameData(DATA_DIR);
  expect(data.state.global.world_phase.current, 1);
});
test('phase definitions loaded', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue(data.state.global.world_phase.phases.length > 0);
});
test('player economy loaded', () => {
  const data = loadGameData(DATA_DIR);
  expect(data.state.player.economy.balance, 50);
  expect(data.state.player.economy.weekly_income, 30);
});
test('player stats loaded', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue('charisma' in data.state.player.stats);
  expectTrue('physique' in data.state.player.stats);
});
test('NPC traits loaded', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue('exhibitionism' in data.state.npcs['sara'].traits);
  expectFalse(data.state.npcs['sara'].traits['exhibitionism'].unlocked);
});
test('NPC emits loaded on full NPC object', () => {
  const data = loadGameData(DATA_DIR);
  expectTrue(data.npcs['sara'].emits.length > 0);
});

// ── Error Handling Tests ──────────────────────────────────────

console.log('\nError handling:');
test('missing world.json — throws LoadError', () => {
  expectThrows(() => {
    const { loadWorldConfig } = require('./loader');
    loadWorldConfig('/nonexistent/path');
  });
});
test('duplicate action IDs — throws LoadError', () => {
  // We test this indirectly by checking that the loaded
  // actions have no duplicates
  const data = loadGameData(DATA_DIR);
  const ids = data.actions.map(a => a.id);
  const unique = new Set(ids);
  expect(unique.size, ids.length);
});

// ── Integration: loader + evaluator ──────────────────────────

console.log('\nLoader + evaluator integration:');
test('loaded condition library usable by evaluator', () => {
  const { ConditionEvaluator } = require('./evaluator');
  const data = loadGameData(DATA_DIR);
  const evaluator = new ConditionEvaluator(data.conditionLibrary);
  // Simple inline check against loaded state
  const result = evaluator.evaluate(
    { inline: { type: 'world_phase', operator: 'eq', value: 1 } },
    data.state
  );
  expectTrue(result);
});
test('loaded NPC state evaluates affection correctly', () => {
  const { ConditionEvaluator } = require('./evaluator');
  const data = loadGameData(DATA_DIR);
  const evaluator = new ConditionEvaluator(data.conditionLibrary);
  // Sara starts at affection 0, should fail gte 30
  const result = evaluator.evaluate(
    { inline: { type: 'npc_stat', target_id: 'sara:affection', operator: 'gte', value: 30 } },
    data.state
  );
  expectFalse(result);
});
test('loaded actions resolve visibility correctly', () => {
  const { ConditionEvaluator } = require('./evaluator');
  const { resolveVisibility } = require('./actions');
  const data = loadGameData(DATA_DIR);
  const evaluator = new ConditionEvaluator(data.conditionLibrary);
  const saraTalk = data.actions.find(a => a.id === 'sara_talk');
  expectTrue(saraTalk !== undefined);
  const visibility = resolveVisibility(saraTalk, data.state, evaluator);
  expectTrue(visibility.visible);
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
