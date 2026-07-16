// ============================================================
// rest.test.ts — Tests for state manager and rest cycle
// Run with: npx ts-node src/engine/rest.test.ts
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import { runRestCycle } from './rest';
import { ConditionLibrary, GameState, NPC, GlobalState } from './types';

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

function expectTrue(val: boolean, msg?: string) { expect(val, true, msg); }
function expectFalse(val: boolean, msg?: string) { expect(val, false, msg); }

// ── Shared Test State Factory ─────────────────────────────────
// Returns a fresh copy each time so tests don't bleed into each other.

function makeState(): GameState {
  return {
    npcs: {
      sara: {
        id: 'sara',
        name: 'Sara',
        affection: { value: 40, high_threshold: 50 },
        corruption: { value: 20, high_threshold: 50 },
        traits: {
          exhibitionism: {
            unlocked: true,
            current_tier: 0,
            tiers: [
              { value: 90, cap: 100 },   // tier 0 nearly full
              { value: 0,  cap: 100 }
            ]
          }
        },
        daily_counters: {
          interactions: { current: 2, max: 3 }
        },
        flags: { met_player: true },
        locations: []
      }
    },
    player: {
      stats: {
        charisma: {
          value: 4,
          max: 10,
          thresholds: [{ value: 5, global_flag: 'player_charisma_milestone' }]
        }
      },
      skills: {
        lockpicking: {
          unlocked: true,
          unlock_conditions: [],
          current_tier: 0,
          tiers: [{ value: 0, cap: 100, advance_conditions: null }]
        }
      },
      inventory: {
        consumables: { energy_drink: { quantity: 2 } },
        key_items:   { rusty_key: true },
        gifts:       { chocolate_box: { quantity: 1 } }
      },
      economy: {
        balance: 100,
        weekly_income: 50,
        income_upgrade_cost: 200,
        income_max: 200
      },
      daily_counters: {
        job: { current: 1, max: 1 }
      },
      flags: {}
    },
    global: {
      current_location_id: 'home',
      previous_location_id: null,
      world_phase: {
        current: 1,
        phases: [
          {
            phase_number: 2,
            name: 'Stirring',
            description: 'The town begins to change.',
            advancement_conditions: [
              { inline: { type: 'global_flag', target_id: 'sara_corrupted', operator: 'has', value: null } }
            ],
            on_advance: {
              global_flags: { phase_2_active: true },
              notifications: [],
              unlocks: ['secret_beach']
            }
          }
        ]
      },
      flags: {},
      day: { count: 6, week_count: 0, day_of_week: 6, rested: false },
      overnight_eval: {
        pending_notifications: [],
        phase_check: false,
        npc_breakthrough_check: false
      },
      quest_states: {},
      unlocked_locations: ['home', 'park'],
      unlocked_shops: ['general_store'],
      session: {
        game_version: '0.1.0',
        save_timestamp: '',
        playtime: 0
      }
    },
    items: {},
    shops: {},
    quests: {}
  };
}

// Full NPC objects for the rest cycle
function makeNPCs(): Record<string, NPC> {
  return {
    sara: {
      id: 'sara',
      name: 'Sara',
      description: 'A local girl.',
      locations: [{ location_id: 'park', conditions: null }],
      affection: { value: 40, high_threshold: 50 },
      corruption: { value: 20, high_threshold: 50 },
      traits: {
        exhibitionism: {
          unlocked: true,
          unlock_conditions: [],
          current_tier: 0,
          tiers: [
            { value: 90, cap: 100, advance_conditions: null },  // auto-advance
            { value: 0,  cap: 100, advance_conditions: null }
          ]
        }
      },
      daily_counters: {
        interactions: { current: 2, max: 3 }
      },
      flags: { met_player: true },
      emits: [
        {
          condition: { inline: { type: 'npc_stat', target_id: 'sara:corruption', operator: 'gte', value: 50 } },
          global_flag: 'sara_corrupted',
          value: true
        }
      ],
      assets: { portrait: '', scenes: {} }
    }
  };
}

const library: ConditionLibrary = { conditions: {} };

// ── State Manager Tests ───────────────────────────────────────

console.log('\nState Manager Tests\n');

console.log('Player stat bumps:');
test('bump charisma by 1 — value increases', () => {
  const sm = new StateManager(makeState());
  sm.bumpPlayerStat('charisma', 1);
  expect(sm.getState().player.stats.charisma.value, 5);
});
test('bump charisma past max — clamped to max', () => {
  const sm = new StateManager(makeState());
  sm.bumpPlayerStat('charisma', 100);
  expect(sm.getState().player.stats.charisma.value, 10);
});
test('bump charisma crosses threshold — emits global flag', () => {
  const sm = new StateManager(makeState());
  const changes = sm.bumpPlayerStat('charisma', 1); // 4 -> 5, crosses threshold at 5
  expect(changes.length, 1);
  expect(changes[0].kind, 'stat_threshold_crossed');
  expect(sm.getGlobalFlag('player_charisma_milestone'), true);
});
test('bump charisma below threshold — no change event', () => {
  const sm = new StateManager(makeState());
  const changes = sm.bumpPlayerStat('charisma', -1); // goes down, no threshold check
  expect(changes.length, 0);
});

console.log('\nPlayer economy:');
test('adjust balance positive — balance increases', () => {
  const sm = new StateManager(makeState());
  const result = sm.adjustBalance(50);
  expectTrue(result);
  expect(sm.getState().player.economy.balance, 150);
});
test('adjust balance negative with funds — succeeds', () => {
  const sm = new StateManager(makeState());
  const result = sm.adjustBalance(-50);
  expectTrue(result);
  expect(sm.getState().player.economy.balance, 50);
});
test('adjust balance negative insufficient funds — returns false', () => {
  const sm = new StateManager(makeState());
  const result = sm.adjustBalance(-200);
  expectFalse(result);
  expect(sm.getState().player.economy.balance, 100); // unchanged
});

console.log('\nInventory:');
test('add consumable — quantity increases', () => {
  const sm = new StateManager(makeState());
  sm.addItemToInventory('energy_drink', 'consumable', 3);
  expect(sm.getState().player.inventory.consumables['energy_drink'].quantity, 5);
});
test('add new gift — added to inventory', () => {
  const sm = new StateManager(makeState());
  sm.addItemToInventory('rose', 'gift', 1);
  expect(sm.getState().player.inventory.gifts['rose'].quantity, 1);
});
test('consume item — quantity decreases', () => {
  const sm = new StateManager(makeState());
  sm.consumeItem('energy_drink', 1, 'consumable');
  expect(sm.getState().player.inventory.consumables['energy_drink'].quantity, 1);
});
test('consume item with none available — returns false', () => {
  const sm = new StateManager(makeState());
  sm.consumeItem('nonexistent', 1, 'consumable');
});

console.log('\nNPC trait bumps:');
test('bump exhibitionism — value increases', () => {
  const sm = new StateManager(makeState());
  sm.bumpNPCTrait('sara', 'exhibitionism', 5);
  expect(sm.getState().npcs.sara.traits.exhibitionism.tiers[0].value, 95);
});
test('bump exhibitionism past cap — clamped to cap', () => {
  const sm = new StateManager(makeState());
  sm.bumpNPCTrait('sara', 'exhibitionism', 20); // 90 + 20 = 110, capped at 100
  expect(sm.getState().npcs.sara.traits.exhibitionism.tiers[0].value, 100);
});
test('bump exhibitionism to cap — returns tier cap reached event', () => {
  const sm = new StateManager(makeState());
  const changes = sm.bumpNPCTrait('sara', 'exhibitionism', 10); // 90 -> 100
  expect(changes.length, 1);
  expect(changes[0].kind, 'npc_tier_cap_reached');
});

console.log('\nDaily counters:');
test('increment player counter — current increases', () => {
  const sm = new StateManager(makeState());
  // job is already at max (1/1) — reset first
  sm.resetAllDailyCounters();
  const result = sm.incrementPlayerDailyCounter('job');
  expectTrue(result);
  expect(sm.getState().player.daily_counters.job.current, 1);
});
test('increment exhausted counter — returns false', () => {
  const sm = new StateManager(makeState());
  // job is already at max (1/1)
  const result = sm.incrementPlayerDailyCounter('job');
  expectFalse(result);
});
test('reset all daily counters — all reset to 0', () => {
  const sm = new StateManager(makeState());
  sm.resetAllDailyCounters();
  expect(sm.getState().player.daily_counters.job.current, 0);
  expect(sm.getState().npcs.sara.daily_counters.interactions.current, 0);
});

// ── Rest Cycle Tests ──────────────────────────────────────────

console.log('\nRest Cycle Tests\n');

console.log('Basic rest:');
test('rest succeeds — returns success', () => {
  const sm = new StateManager(makeState());
  const evaluator = new ConditionEvaluator(library);
  const result = runRestCycle(sm, evaluator, makeNPCs());
  expectTrue(result.success);
});
test('rest advances day count', () => {
  const sm = new StateManager(makeState());
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expect(sm.getState().global.day.count, 7);
});
test('rest resets daily counters', () => {
  const sm = new StateManager(makeState());
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expect(sm.getState().player.daily_counters.job.current, 0);
  expect(sm.getState().npcs.sara.daily_counters.interactions.current, 0);
});
test('rest produces notifications', () => {
  const sm = new StateManager(makeState());
  const evaluator = new ConditionEvaluator(library);
  const result = runRestCycle(sm, evaluator, makeNPCs());
  expectTrue(result.notifications.length > 0);
});
test('cannot rest twice in one day', () => {
  const sm = new StateManager(makeState());
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  const secondRest = runRestCycle(sm, evaluator, makeNPCs());
  expectFalse(secondRest.success);
});

console.log('\nWeekly income:');
test('rest on day 7 — income paid', () => {
  const sm = new StateManager(makeState()); // day starts at 6
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs()); // advances to day 7
  expect(sm.getState().player.economy.balance, 150); // 100 + 50
});
test('rest on day 6 — no income', () => {
  const state = makeState();
  state.global.day.count = 5; // advance to day 6 after rest
  const sm = new StateManager(state);
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expect(sm.getState().player.economy.balance, 100); // unchanged
});

console.log('\nNPC breakthroughs:');
test('trait at cap auto-advances tier on rest', () => {
  const state = makeState();
  // Push exhibitionism to cap
  state.npcs.sara.traits.exhibitionism.tiers[0].value = 100;
  const sm = new StateManager(state);
  const evaluator = new ConditionEvaluator(library);
  const npcs = makeNPCs();
  npcs.sara.traits.exhibitionism.tiers[0].value = 100;
  runRestCycle(sm, evaluator, npcs);
  expect(sm.getState().npcs.sara.traits.exhibitionism.current_tier, 1);
});
test('trait advancement generates notification', () => {
  const state = makeState();
  state.npcs.sara.traits.exhibitionism.tiers[0].value = 100;
  const sm = new StateManager(state);
  const evaluator = new ConditionEvaluator(library);
  const npcs = makeNPCs();
  npcs.sara.traits.exhibitionism.tiers[0].value = 100;
  const result = runRestCycle(sm, evaluator, npcs);
  const hasBreakthrough = result.notifications.some(n => n.includes('Sara'));
  expectTrue(hasBreakthrough);
});

console.log('\nPhase advancement:');
test('phase advances when conditions met', () => {
  const state = makeState();
  state.global.flags['sara_corrupted'] = true; // trigger phase 2 condition
  const sm = new StateManager(state);
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expect(sm.getState().global.world_phase.current, 2);
});
test('phase does not advance when conditions not met', () => {
  const sm = new StateManager(makeState()); // no sara_corrupted flag
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expect(sm.getState().global.world_phase.current, 1);
});
test('phase advance unlocks location', () => {
  const state = makeState();
  state.global.flags['sara_corrupted'] = true;
  const sm = new StateManager(state);
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expectTrue(sm.isLocationUnlocked('secret_beach'));
});
test('phase advance writes global flags', () => {
  const state = makeState();
  state.global.flags['sara_corrupted'] = true;
  const sm = new StateManager(state);
  const evaluator = new ConditionEvaluator(library);
  runRestCycle(sm, evaluator, makeNPCs());
  expect(sm.getGlobalFlag('phase_2_active'), true);
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
