// ============================================================
// actions.test.ts — Tests for the action system
// Run with: npx ts-node src/engine/actions.test.ts
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import {
  resolveVisibility,
  resolveAvailability,
  getActionStatus,
  getContextActions,
  executeAction,
} from './actions';
import { Action, ConditionLibrary, GameState } from './types';

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

// ── Test State Factory ────────────────────────────────────────

function makeState(): GameState {
  return {
    npcs: {
      sara: {
        id: 'sara',
        name: 'Sara',
        locations: [{ location_id: 'park', conditions: null }],
        affection:  { value: 30, high_threshold: 50 },
        corruption: { value: 10, high_threshold: 50 },
        traits: {
          exhibitionism: {
            unlocked: true,
            current_tier: 0,
            tiers: [{ value: 20, cap: 100 }, { value: 0, cap: 100 }]
          }
        },
        daily_counters: { interactions: { current: 0, max: 3 } },
        flags: { met_player: true }
      }
    },
    player: {
      stats: {
        charisma: { value: 3, max: 10, thresholds: [] }
      },
      skills: {},
      inventory: {
        consumables: { energy_drink: { quantity: 2 } },
        key_items:   { rusty_key: true, locked_box: false },
        gifts:       { chocolate_box: { quantity: 1 } }
      },
      economy: {
        balance: 100,
        weekly_income: 50,
        income_upgrade_cost: 200,
        income_max: 200
      },
      daily_counters: { job: { current: 0, max: 1 } },
      flags: { completed_tutorial: true }
    },
    global: {
      current_location_id: 'park',
      previous_location_id: 'home',
      world_phase: { current: 1, phases: [] },
      flags: {},
      day: { count: 3, week_count: 0, day_of_week: 3, rested: false },
      overnight_eval: {
        pending_notifications: [],
        phase_check: false,
        npc_breakthrough_check: false
      },
      quest_states: {
        intro_quest: {
          quest_id: 'intro_quest',
          current_stage_index: 0,
          started_at: { day: 1, phase: 1 },
          stage_started_at: { day: 1, phase: 1 },
          completed: true,
          failed: false
        }
      },
      unlocked_locations: ['home', 'park'],
      unlocked_shops: ['general_store'],
      session: { game_version: '0.1.0', save_timestamp: '', playtime: 0 }
    },
    items: {},
    shops: {},
    quests: {}
  };
}

// ── Action Factories ──────────────────────────────────────────
// Build minimal valid Action objects for testing.

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    id: 'test_action',
    name: 'Test Action',
    description: 'A test action.',
    action_type: 'npc_interaction',
    context: { type: 'npc', target_id: 'sara' },
    visibility: { conditions: null },
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null }
    },
    effects: {
      text: 'You do the thing.',
      text_key: null,
      scene_id: null,
      stat_bumps: null,
      npc_effects: null,
      money_delta: null,
      player_flags: null,
      global_emissions: null,
      item_grants: null,
      item_consumes: null,
      quest_triggers: null, event_id: null, event_probability: null },
    assets: { icon: null },
    ...overrides,
  };
}

const library: ConditionLibrary = { conditions: {} };
const evaluator = new ConditionEvaluator(library);

// ── Visibility Tests ──────────────────────────────────────────

console.log('\nAction System Tests\n');

console.log('Visibility:');
test('no conditions — always visible', () => {
  const action = makeAction({ visibility: { conditions: null } });
  const result = resolveVisibility(action, makeState(), evaluator);
  expectTrue(result.visible);
});
test('condition met — visible', () => {
  const action = makeAction({
    visibility: {
      conditions: [{ inline: { type: 'npc_flag', target_id: 'sara:met_player', operator: 'has', value: null } }]
    }
  });
  const result = resolveVisibility(action, makeState(), evaluator);
  expectTrue(result.visible);
});
test('condition not met — not visible', () => {
  const action = makeAction({
    visibility: {
      conditions: [{ inline: { type: 'world_phase', operator: 'gte', value: 3 } }]
    }
  });
  const result = resolveVisibility(action, makeState(), evaluator);
  expectFalse(result.visible);
});

// ── Availability Tests ────────────────────────────────────────

console.log('\nAvailability:');
test('no caps or prerequisites — available', () => {
  const action = makeAction();
  const result = resolveAvailability(action, makeState(), evaluator);
  expectTrue(result.available);
});
test('daily cap not exhausted — available', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: true, max: 3, current: 2, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectTrue(result.available);
});
test('daily cap exhausted — unavailable', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: true, max: 3, current: 3, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectFalse(result.available);
  if (!result.available) expect(result.reason, 'daily_cap_exhausted');
});
test('daily cap exhausted — when_exhausted is hide', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: true, max: 1, current: 1, when_exhausted: 'hide' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectFalse(result.available);
  if (!result.available) expect(result.when_exhausted, 'hide');
});
test('lifetime cap exhausted — unavailable', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: true, max: 5, current: 5, when_exhausted: 'hide' },
      },
      prerequisites: { money: null, items: null, flags: null }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectFalse(result.available);
  if (!result.available) expect(result.reason, 'lifetime_cap_exhausted');
});
test('insufficient funds — unavailable', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: 200, items: null, flags: null }  // player only has 100
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectFalse(result.available);
  if (!result.available) expect(result.reason, 'insufficient_funds');
});
test('sufficient funds — available', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: 50, items: null, flags: null }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectTrue(result.available);
});
test('missing required item — unavailable', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: {
        money: null,
        items: [{ item_id: 'locked_box', consumed_on_use: false }],
        flags: null
      }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectFalse(result.available);
  if (!result.available) expect(result.reason, 'missing_item');
});
test('required item present — available', () => {
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: {
        money: null,
        items: [{ item_id: 'rusty_key', consumed_on_use: false }],
        flags: null
      }
    }
  });
  const result = resolveAvailability(action, makeState(), evaluator);
  expectTrue(result.available);
});

// ── Execution Tests ───────────────────────────────────────────

console.log('\nExecution:');
test('basic action executes — returns success', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({ effects: { text: 'You smile at Sara.', scene_id: null, stat_bumps: null, npc_effects: null, money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null } });
  const result = executeAction(action, sm, evaluator);
  expectTrue(result.success);
});
test('text effect — appears in effects', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({ effects: { text: 'You smile at Sara.', scene_id: null, stat_bumps: null, npc_effects: null, money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null } });
  const result = executeAction(action, sm, evaluator);
  const hasText = result.effects.some(e => e.kind === 'text' && e.detail === 'You smile at Sara.');
  expectTrue(hasText);
});
test('stat bump — player stat increases', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    effects: {
      text: null, scene_id: null,
      stat_bumps: { stat_id: 'charisma', value: 2 },
      npc_effects: null, money_delta: null, player_flags: null,
      global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getState().player.stats.charisma.value, 5);
});
test('npc affection bump — affection increases', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    effects: {
      text: null, scene_id: null, stat_bumps: null,
      npc_effects: { npc_id: 'sara', affection: 5, corruption: null, trait_bumps: null, flags: null },
      money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getState().npcs.sara.affection.value, 35);
});
test('npc trait bump — trait value increases', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    effects: {
      text: null, scene_id: null, stat_bumps: null,
      npc_effects: { npc_id: 'sara', affection: null, corruption: null, trait_bumps: { trait_id: 'exhibitionism', value: 10 }, flags: null },
      money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getState().npcs.sara.traits.exhibitionism.tiers[0].value, 30);
});
test('money gain — balance increases', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    effects: {
      text: null, scene_id: null, stat_bumps: null, npc_effects: null,
      money_delta: 50,
      player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getState().player.economy.balance, 150);
});
test('money cost via prerequisite — balance decreases', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: 30, items: null, flags: null }
    },
    effects: {
      text: 'You buy something.', scene_id: null, stat_bumps: null,
      npc_effects: null, money_delta: null,
      player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getState().player.economy.balance, 70);
});
test('item consumed on use — quantity decreases', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: {
        money: null,
        items: [{ item_id: 'energy_drink', consumed_on_use: true }],
        flags: null
      }
    },
    effects: {
      text: 'You drink an energy drink.', scene_id: null, stat_bumps: null,
      npc_effects: null, money_delta: null,
      player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getState().player.inventory.consumables['energy_drink'].quantity, 1);
});
test('item required but not consumed — quantity unchanged', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: {
        money: null,
        items: [{ item_id: 'rusty_key', consumed_on_use: false }],
        flags: null
      }
    },
    effects: {
      text: 'You use the key.', scene_id: null, stat_bumps: null,
      npc_effects: null, money_delta: null,
      player_flags: null, global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expectTrue(sm.getState().player.inventory.key_items['rusty_key']);
});
test('global emission — flag written to global state', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    effects: {
      text: null, scene_id: null, stat_bumps: null, npc_effects: null, money_delta: null,
      player_flags: null,
      global_emissions: [{ flag: 'saw_the_thing', value: true }],
      quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(sm.getGlobalFlag('saw_the_thing'), true);
});
test('quest trigger — returned in result', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    effects: {
      text: null, scene_id: null, stat_bumps: null, npc_effects: null, money_delta: null,
      player_flags: null, global_emissions: null,
      quest_triggers: ['sara_quest_1'], text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  const result = executeAction(action, sm, evaluator);
  expectTrue(result.quest_triggers.includes('sara_quest_1'));
});
test('daily cap increments on execution', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: true, max: 3, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null }
    },
    effects: {
      text: 'Action taken.', scene_id: null, stat_bumps: null,
      npc_effects: null, money_delta: null, player_flags: null,
      global_emissions: null, quest_triggers: null, text_key: null, item_grants: null, item_consumes: null, event_id: null, event_probability: null }
  });
  executeAction(action, sm, evaluator);
  expect(action.availability.caps.daily.current, 1);
});
test('invisible action — execution fails', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    visibility: {
      conditions: [{ inline: { type: 'world_phase', operator: 'gte', value: 4 } }]
    }
  });
  const result = executeAction(action, sm, evaluator);
  expectFalse(result.success);
});
test('unavailable action — execution fails', () => {
  const sm = new StateManager(makeState());
  const action = makeAction({
    availability: {
      caps: {
        daily:    { enabled: true, max: 1, current: 1, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null }
    }
  });
  const result = executeAction(action, sm, evaluator);
  expectFalse(result.success);
});

// ── Context Query Tests ───────────────────────────────────────

console.log('\nContext queries:');
test('getContextActions — returns only matching context', () => {
  const actions: Action[] = [
    makeAction({ id: 'sara_action_1', context: { type: 'npc', target_id: 'sara' } }),
    makeAction({ id: 'sara_action_2', context: { type: 'npc', target_id: 'sara' } }),
    makeAction({ id: 'park_action',   context: { type: 'location', target_id: 'park' } }),
  ];
  const results = getContextActions(actions, 'npc', 'sara', makeState(), evaluator);
  expect(results.length, 2);
});
test('getContextActions — filters out invisible actions', () => {
  const actions: Action[] = [
    makeAction({ id: 'visible',   context: { type: 'npc', target_id: 'sara' }, visibility: { conditions: null } }),
    makeAction({ id: 'invisible', context: { type: 'npc', target_id: 'sara' }, visibility: { conditions: [{ inline: { type: 'world_phase', operator: 'gte', value: 4 } }] } }),
  ];
  const results = getContextActions(actions, 'npc', 'sara', makeState(), evaluator);
  expect(results.length, 1);
  expect(results[0].action.id, 'visible');
});

// ── Item Grant / Acquisition Tests ───────────────────────────

console.log('\nItem acquisition:');

test('key item grant lands in key_items, not consumables', () => {
  const state = makeState();
  // Register mysterious_key as a key_item in the item registry.
  state.items = { mysterious_key: { id: 'mysterious_key', name: 'Mysterious Key', description: '', item_type: 'key_item' } as any };
  state.player.inventory.key_items = {};
  const sm = new StateManager(state);
  const action = makeAction({
    id: 'find_key',
    action_type: 'location_action',
    context: { type: 'location', target_id: 'park' },
    effects: {
      text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
      money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null,
      item_grants: [{ item_id: 'mysterious_key', quantity: 1 }],
      item_consumes: null, event_id: null, event_probability: null,
    },
  });
  const result = executeAction(action, sm, evaluator);
  expectTrue(result.success);
  expectTrue(sm.getState().player.inventory.key_items['mysterious_key'] === true, 'key not in key_items');
  expectTrue(sm.getState().player.inventory.consumables['mysterious_key'] === undefined, 'key misfiled as consumable');
});

test('granted item satisfies a downstream item prerequisite', () => {
  const state = makeState();
  state.items = { mysterious_key: { id: 'mysterious_key', name: 'Mysterious Key', description: '', item_type: 'key_item' } as any };
  state.player.inventory.key_items = {};
  const sm = new StateManager(state);

  const grant = makeAction({
    id: 'find_key', action_type: 'location_action', context: { type: 'location', target_id: 'park' },
    effects: { text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
      money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null,
      item_grants: [{ item_id: 'mysterious_key', quantity: 1 }], item_consumes: null,
      event_id: null, event_probability: null },
  });
  executeAction(grant, sm, evaluator);

  // A downstream action that requires the key should now be available.
  const trade = makeAction({
    id: 'use_key', action_type: 'npc_interaction', context: { type: 'npc', target_id: 'sara' },
    availability: { caps: { daily: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' }, lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' } },
      prerequisites: { money: null, items: [{ item_id: 'mysterious_key', consumed_on_use: false }], flags: null } },
    visibility: { conditions: null },
    effects: { text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
      money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null,
      item_grants: null, item_consumes: null, event_id: null, event_probability: null },
  });
  const status = getActionStatus(trade, sm.getState(), evaluator);
  expectTrue(status.availability !== null && status.availability.available, 'trade should be available once key held');
});

test('unregistered item grant falls back to consumable (legacy-safe)', () => {
  const state = makeState();
  state.items = {};
  state.player.inventory.consumables = {};
  const sm = new StateManager(state);
  const action = makeAction({
    id: 'grab_unknown', action_type: 'location_action', context: { type: 'location', target_id: 'park' },
    effects: { text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
      money_delta: null, player_flags: null, global_emissions: null, quest_triggers: null,
      item_grants: [{ item_id: 'unknown_trinket', quantity: 1 }], item_consumes: null,
      event_id: null, event_probability: null },
  });
  const result = executeAction(action, sm, evaluator);
  expectTrue(result.success);
  expectTrue(sm.getState().player.inventory.consumables['unknown_trinket']?.quantity === 1, 'unknown item should be consumable');
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
