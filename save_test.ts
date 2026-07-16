// ============================================================
// save_test.ts — Tests for save/load persistence
// Run with: npx ts-node save_test.ts
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { saveGame, loadGame, listSlots, slotPath, SaveError } from './save';
import { GameState, Action } from './types';

// ── Fixtures ─────────────────────────────────────────────────

function makeState(): GameState {
  return {
    npcs: {
      alex: {
        id: 'alex',
        name: 'Alex',
        locations: [],
        affection: { value: 25, high_threshold: 50 },
        corruption: { value: 10, high_threshold: 50 },
        traits: {},
        daily_counters: {},
        flags: { met_player: true },
      },
    },
    player: {
      stats: { charisma: { value: 3, max: 10, thresholds: [] } },
      skills: {},
      inventory: { consumables: { coffee: { quantity: 2 } }, key_items: {}, gifts: {} },
      economy: { balance: 120, weekly_income: 50, income_upgrade_cost: 200, income_max: 200 },
      daily_counters: {},
      flags: { seen_intro: true },
    },
    global: {
      current_location_id: 'bar',
      previous_location_id: 'home',
      world_phase: { current: 2, phases: [] },
      flags: { alex_corrupted: false },
      day: { count: 9, week_count: 1, day_of_week: 2, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: { meet_alex: 'active' as any },
      unlocked_locations: ['home', 'bar', 'park'],
      unlocked_shops: [],
      session: { game_version: '0.1.0', save_timestamp: '', playtime: 42 },
    },
    items: {},
    shops: {},
    quests: {},
  } as unknown as GameState;
}

function makeAction(id: string, dailyCurrent: number, lifetimeCurrent: number): Action {
  return {
    id,
    name: id,
    description: '',
    action_type: 'location_action',
    context: { type: 'location', target_id: '' },
    visibility: { conditions: [] },
    availability: {
      caps: {
        daily: { enabled: true, max: 3, current: dailyCurrent, when_exhausted: 'grey_out' },
        lifetime: { enabled: true, max: 5, current: lifetimeCurrent, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null },
    },
    effects: {
      text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
      money_delta: null, player_flags: null, global_emissions: null,
      item_grants: null, item_consumes: null, quest_triggers: null,
      event_id: null, event_probability: null,
    },
    assets: { icon: null },
  } as unknown as Action;
}

// ── Harness ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(description: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${description}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${description}`);
    console.log(`    ${(err as Error).message}`);
  }
}

function expectEqual(actual: any, expected: any, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(actual: boolean, msg?: string) {
  if (!actual) throw new Error(msg || `Expected true, got ${actual}`);
}

function expectThrows(fn: () => void, msg?: string) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(msg || 'Expected function to throw');
}

// Fresh temp saves dir per run.
const savesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-saves-'));

// ── slotPath ─────────────────────────────────────────────────
console.log('\nslotPath:');
test('sanitizes unsafe slot names', () => {
  const p = slotPath(savesDir, '../evil/slot name');
  expectTrue(!p.includes('..'), 'traversal not stripped');
  expectTrue(p.endsWith('.json'), 'not a json path');
});

// ── Round-trip fidelity ──────────────────────────────────────
console.log('\nRound-trip fidelity:');
test('save then load reproduces state', () => {
  const state = makeState();
  const actions = [makeAction('work', 0, 0)];
  saveGame(state, actions, savesDir, 'rt');
  const loaded = loadGame(actions, savesDir, 'rt');
  expectEqual(loaded.player.economy.balance, 120);
  expectEqual(loaded.global.day.count, 9);
  expectEqual(loaded.npcs.alex.affection.value, 25);
  expectEqual(loaded.player.inventory.consumables.coffee.quantity, 2);
  expectEqual(loaded.global.unlocked_locations.length, 3);
});

// ── Action cap round-trip (the headline gotcha) ──────────────
console.log('\nAction cap persistence:');
test('lifetime cap counter survives save/load', () => {
  const state = makeState();
  const saveActions = [makeAction('special', 2, 4)];  // lifetime 4/5 used
  saveGame(state, saveActions, savesDir, 'caps');

  // Simulate a fresh process: brand-new action objects at 0/0.
  const freshActions = [makeAction('special', 0, 0)];
  loadGame(freshActions, savesDir, 'caps');
  expectEqual(freshActions[0].availability.caps.daily.current, 2);
  expectEqual(freshActions[0].availability.caps.lifetime.current, 4);
});
test('actions absent from snapshot keep loaded values', () => {
  const state = makeState();
  saveGame(state, [makeAction('a', 1, 1)], savesDir, 'partial');
  const freshActions = [makeAction('a', 0, 0), makeAction('b', 0, 3)];
  loadGame(freshActions, savesDir, 'partial');
  expectEqual(freshActions[0].availability.caps.lifetime.current, 1, 'a restored');
  expectEqual(freshActions[1].availability.caps.lifetime.current, 3, 'b untouched');
});

// ── Metadata ─────────────────────────────────────────────────
console.log('\nMetadata:');
test('save stamps timestamp into session block', () => {
  const state = makeState();
  saveGame(state, [], savesDir, 'ts');
  const loaded = loadGame([], savesDir, 'ts');
  expectTrue(loaded.global.session.save_timestamp.length > 0);
});

// ── Slot listing ─────────────────────────────────────────────
console.log('\nSlot listing:');
test('listSlots returns saved slot names', () => {
  saveGame(makeState(), [], savesDir, 'zzz_slot');
  const slots = listSlots(savesDir);
  expectTrue(slots.includes('zzz_slot'));
});

// ── Error handling ───────────────────────────────────────────
console.log('\nError handling:');
test('loading a missing slot throws SaveError', () => {
  expectThrows(() => loadGame([], savesDir, 'does_not_exist'));
});
test('version mismatch throws SaveError', () => {
  const p = slotPath(savesDir, 'badver');
  fs.writeFileSync(p, JSON.stringify({ version: 999, saved_at: '', state: makeState(), action_caps: {} }));
  expectThrows(() => loadGame([], savesDir, 'badver'));
});
test('malformed JSON throws SaveError', () => {
  const p = slotPath(savesDir, 'garbage');
  fs.writeFileSync(p, '{ not valid json ');
  expectThrows(() => loadGame([], savesDir, 'garbage'));
});

// ── Cleanup ──────────────────────────────────────────────────
try { fs.rmSync(savesDir, { recursive: true, force: true }); } catch { /* ignore */ }

// ── Summary ──────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
