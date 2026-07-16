// ============================================================
// random_events.test.ts — Tests for the random event resolver
// Run with: npx ts-node src/engine/random_events.test.ts
// ============================================================

import { evaluateRandomEvent, evaluateLocationEvents, evaluateActionEvents, markEventFired, applyEventRewards } from './random_events';
import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import { GameState, RandomEvent, ConditionLibrary } from './types';

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

function expectTrue(val: any, msg?: string) { expect(!!val, true, msg); }
function expectFalse(val: any, msg?: string) { expect(!!val, false, msg); }

// ── Test Data ────────────────────────────────────────────────

const library: ConditionLibrary = { conditions: {} };
const evaluator = new ConditionEvaluator(library);

function makeState(day: number = 5): GameState {
  return {
    npcs: {},
    player: {
      stats: { charisma: { value: 3, max: 10, thresholds: [] } },
      skills: {},
      inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 100, weekly_income: 50, income_upgrade_cost: 200, income_max: 200 },
      daily_counters: {},
      flags: {}
    },
    global: {
      current_location_id: 'park',
      previous_location_id: null,
      world_phase: { current: 1, phases: [] },
      flags: {},
      day: { count: day, week_count: 0, day_of_week: 0, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {},
      unlocked_locations: ['home', 'park'],
      unlocked_shops: [],
      session: { game_version: '0.1.0', save_timestamp: '', playtime: 0 }
    },
    items: {},
    shops: {},
    quests: {}
  };
}

function makeEvent(overrides: Partial<RandomEvent> = {}): RandomEvent {
  return {
    event_id: 'test_event',
    conditions: null,
    probability: 1.0,
    trigger: 'on_visit',
    trigger_action_id: null,
    cooldown: { type: 'none', last_fired: null },
    content: {
      text: 'Something happened!',
      rewards: { money: 10, items: null, stat_bumps: null }
    },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

console.log('\nRandom Event Tests\n');

console.log('Cooldown checks:');

test('none cooldown — always ready', () => {
  const event = makeEvent({ cooldown: { type: 'none', last_fired: null } });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectTrue(result.fired);
});

test('one_time cooldown — ready if never fired', () => {
  const event = makeEvent({ cooldown: { type: 'one_time', last_fired: null } });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectTrue(result.fired);
});

test('one_time cooldown — blocked if already fired', () => {
  const event = makeEvent({ cooldown: { type: 'one_time', last_fired: 1 } });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectFalse(result.fired);
  expect(result.reason, 'cooldown');
});

test('per_day cooldown — ready on different day', () => {
  const event = makeEvent({ cooldown: { type: 'per_day', last_fired: 1 } });
  const result = evaluateRandomEvent(event, makeState(5), evaluator);
  expectTrue(result.fired);
});

test('per_day cooldown — blocked on same day', () => {
  const event = makeEvent({ cooldown: { type: 'per_day', last_fired: 5 } });
  const result = evaluateRandomEvent(event, makeState(5), evaluator);
  expectFalse(result.fired);
  expect(result.reason, 'cooldown');
});

console.log('\nCondition checks:');

test('conditions met — fires', () => {
  const event = makeEvent({
    conditions: [{ inline: { type: 'day_count', operator: 'gte', value: 1 } }]
  });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectTrue(result.fired);
});

test('conditions not met — blocked', () => {
  const event = makeEvent({
    conditions: [{ inline: { type: 'day_count', operator: 'gte', value: 100 } }]
  });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectFalse(result.fired);
  expect(result.reason, 'conditions_not_met');
});

console.log('\nProbability checks:');

test('probability 1.0 — always fires', () => {
  const event = makeEvent({ probability: 1.0 });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectTrue(result.fired);
});

test('probability 0.0 — never fires', () => {
  const event = makeEvent({ probability: 0.0 });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectFalse(result.fired);
  expect(result.reason, 'probability_roll_failed');
});

console.log('\nTrigger type filtering:');

test('on_visit event fires when trigger is on_visit', () => {
  const event = makeEvent({ trigger: 'on_visit' });
  const result = evaluateRandomEvent(event, makeState(), evaluator);
  expectTrue(result.fired);
});

console.log('\nReward application:');

test('money reward applied', () => {
  const state = makeState();
  const sm = new StateManager(state);
  const resolution = {
    event_id: 'test',
    text: 'Test',
    rewards: { money: 25, items: null, stat_bumps: null }
  };
  const result = applyEventRewards(resolution, sm);
  expect(sm.getState().player.economy.balance, 125);
  expectTrue(result.notifications.some(n => n.includes('25')));
});

test('stat bump reward applied', () => {
  const state = makeState();
  const sm = new StateManager(state);
  const resolution = {
    event_id: 'test',
    text: 'Test',
    rewards: { money: null, items: null, stat_bumps: { charisma: 2 } }
  };
  applyEventRewards(resolution, sm);
  expect(sm.getState().player.stats.charisma.value, 5);
});

console.log('\nCooldown marking:');

test('markEventFired updates last_fired', () => {
  const event = makeEvent({ cooldown: { type: 'per_day', last_fired: null } });
  markEventFired(event, 5);
  expect(event.cooldown.last_fired, 5);
});

console.log('\nLocation event resolution:');

test('evaluateLocationEvents — random event fires first', () => {
  const randomEvent = makeEvent({ event_id: 'random_1', probability: 1.0 });
  const state = makeState();
  const result = evaluateLocationEvents([randomEvent], null, state, evaluator);
  expectTrue(result.fired);
  expect(result.resolution!.event_id, 'random_1');
});

test('evaluateLocationEvents — skips on_action events', () => {
  const randomEvent = makeEvent({ event_id: 'action_only', trigger: 'on_action' });
  const state = makeState();
  const result = evaluateLocationEvents([randomEvent], null, state, evaluator);
  expectFalse(result.fired);
});

test('evaluateLocationEvents — falls back to event_triggers', () => {
  const state = makeState();
  const result = evaluateLocationEvents([], [{ event_id: 'fallback', probability: 1.0 }], state, evaluator);
  expectTrue(result.fired);
  expect(result.triggered_event_id, 'fallback');
});

test('evaluateLocationEvents — random event takes priority over event_triggers', () => {
  const randomEvent = makeEvent({ event_id: 'random_priority', probability: 1.0 });
  const state = makeState();
  const result = evaluateLocationEvents(
    [randomEvent],
    [{ event_id: 'fallback', probability: 1.0 }],
    state,
    evaluator
  );
  expectTrue(result.fired);
  expect(result.resolution!.event_id, 'random_priority');
});

console.log('\nAction Event Resolution:');

test('evaluateActionEvents — matching action triggers event', () => {
  const actionEvent = makeEvent({
    event_id: 'action_triggered',
    trigger: 'on_action',
    trigger_action_id: 'test_action',
  });
  const state = makeState();
  const result = evaluateActionEvents([actionEvent], 'test_action', state, evaluator);
  expectTrue(result.fired);
  expect(result.resolution!.event_id, 'action_triggered');
});

test('evaluateActionEvents — wrong action does not trigger', () => {
  const actionEvent = makeEvent({
    event_id: 'action_triggered',
    trigger: 'on_action',
    trigger_action_id: 'other_action',
  });
  const state = makeState();
  const result = evaluateActionEvents([actionEvent], 'test_action', state, evaluator);
  expectFalse(result.fired);
});

test('evaluateActionEvents — on_visit event does not trigger', () => {
  const visitEvent = makeEvent({
    event_id: 'visit_only',
    trigger: 'on_visit',
  });
  const state = makeState();
  const result = evaluateActionEvents([visitEvent], 'test_action', state, evaluator);
  expectFalse(result.fired);
});

test('evaluateActionEvents — cooldown blocks action event', () => {
  const actionEvent = makeEvent({
    event_id: 'action_triggered',
    trigger: 'on_action',
    trigger_action_id: 'test_action',
    cooldown: { type: 'one_time', last_fired: 1 },
  });
  const state = makeState();
  const result = evaluateActionEvents([actionEvent], 'test_action', state, evaluator);
  expectFalse(result.fired);
});

test('evaluateActionEvents — first match wins', () => {
  const event1 = makeEvent({
    event_id: 'first',
    trigger: 'on_action',
    trigger_action_id: 'test_action',
  });
  const event2 = makeEvent({
    event_id: 'second',
    trigger: 'on_action',
    trigger_action_id: 'test_action',
  });
  const state = makeState();
  const result = evaluateActionEvents([event1, event2], 'test_action', state, evaluator);
  expectTrue(result.fired);
  expect(result.resolution!.event_id, 'first');
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
