// ============================================================
// events_test.ts — Tests for the event system
// Run with: npx ts-node events_test.ts
// ============================================================

import {
  resolveEventChoice,
  loadEvent,
  getAvailableChoices,
  getEventWithAvailableChoices,
  evaluateLocationEventTrigger,
  evaluateActionEventTrigger,
  resolveEventPriority,
} from './events';
import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { Event, GameState, QuestStatus } from './types';

// ── Test State ───────────────────────────────────────────────

const baseState: GameState = {
  npcs: {
    sara: {
      id: 'sara',
      name: 'Sara',
      affection: { value: 30, high_threshold: 50 },
      corruption: { value: 10, high_threshold: 50 },
      traits: {},
      daily_counters: {},
      flags: { met_player: true },
      locations: [{ location_id: 'park', conditions: null }],
    },
  },
  player: {
    stats: {
      charisma: { value: 2, max: 10, thresholds: [] },
      intelligence: { value: 1, max: 10, thresholds: [] },
    },
    skills: {},
    inventory: {
      consumables: {},
      key_items: {},
      gifts: {},
    },
    economy: {
      balance: 50,
      weekly_income: 50,
      income_upgrade_cost: 200,
      income_max: 200,
    },
    daily_counters: {},
    flags: {},
  },
  global: {
    current_location_id: 'park',
    previous_location_id: null,
    world_phase: { current: 1, phases: [] },
    flags: {},
    day: { count: 1, week_count: 0, day_of_week: 0, rested: false },
    overnight_eval: {
      pending_notifications: [],
      phase_check: false,
      npc_breakthrough_check: false,
    },
    quest_states: {},
    unlocked_locations: ['park', 'home'],
    unlocked_shops: [],
    session: {
      game_version: '0.1.0',
      save_timestamp: '',
      playtime: 0,
    },
  },
  items: {},
  shops: {},
  quests: {},
};

const emptyLibrary = { conditions: {} };

// ── Test Events ──────────────────────────────────────────────

const simpleEvent: Event = {
  id: 'greeting',
  text: 'Sara smiles at you.',
  choices: [
    {
      text: 'Say hello',
      prerequisites: null,
      effects: {
        text: 'You wave. Sara waves back.',
        text_key: null,
        scene_id: null,
        stat_bumps: null,
        npc_effects: {
          npc_id: 'sara',
          affection: 5,
          corruption: null,
          trait_bumps: null,
          flags: { greeted: true },
        },
        money_delta: null,
        player_flags: null,
        global_emissions: null,
        item_grants: null,
        item_consumes: null,
        quest_triggers: null,
        event_id: null,
        event_probability: null,
      },
    },
    {
      text: 'Ignore her',
      prerequisites: null,
      effects: {
        text: 'You look away.',
        text_key: null,
        scene_id: null,
        stat_bumps: null,
        npc_effects: {
          npc_id: 'sara',
          affection: -5,
          corruption: null,
          trait_bumps: null,
          flags: { ignored: true },
        },
        money_delta: null,
        player_flags: null,
        global_emissions: null,
        item_grants: null,
        item_consumes: null,
        quest_triggers: null,
        event_id: null,
        event_probability: null,
      },
    },
  ],
};

const gatedEvent: Event = {
  id: 'gated_greeting',
  text: 'A mysterious figure approaches.',
  choices: [
    {
      text: 'Ask about the key',
      prerequisites: [
        { inline: { type: 'player_stat', target_id: 'charisma', operator: 'gte', value: 3 } },
      ],
      effects: {
        text: 'The figure nods.',
        text_key: null,
        scene_id: null,
        stat_bumps: null,
        npc_effects: null,
        money_delta: null,
        player_flags: null,
        global_emissions: null,
        item_grants: null,
        item_consumes: null,
        quest_triggers: null,
        event_id: null,
        event_probability: null,
      },
    },
    {
      text: 'Say nothing',
      prerequisites: null,
      effects: {
        text: 'You stare in silence.',
        text_key: null,
        scene_id: null,
        stat_bumps: null,
        npc_effects: null,
        money_delta: null,
        player_flags: null,
        global_emissions: null,
        item_grants: null,
        item_consumes: null,
        quest_triggers: null,
        event_id: null,
        event_probability: null,
      },
    },
  ],
};

// ── Test Runner ──────────────────────────────────────────────

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

function expectEqual(actual: any, expected: any, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function expectTrue(actual: boolean, msg?: string) {
  if (!actual) {
    throw new Error(msg ?? `Expected true, got ${actual}`);
  }
}

// ── Tests ────────────────────────────────────────────────────

console.log('\nEvent System Tests\n');

// ── loadEvent ────────────────────────────────────────────────
console.log('loadEvent:');
test('returns event when found', () => {
  const events = { greeting: simpleEvent };
  const result = loadEvent(events, 'greeting');
  expectTrue(result !== null, 'Expected event to be found');
  expectEqual(result!.id, 'greeting');
});
test('returns null when not found', () => {
  const events = { greeting: simpleEvent };
  const result = loadEvent(events, 'missing');
  expectEqual(result, null);
});

// ── getAvailableChoices ──────────────────────────────────────
console.log('\ngetAvailableChoices:');
test('returns all choices when no prerequisites', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const choices = getAvailableChoices(simpleEvent, state, evaluator);
  expectEqual(choices.length, 2);
});
test('filters choices by prerequisites', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  // charisma is 2, gated choice requires >= 3
  const choices = getAvailableChoices(gatedEvent, state, evaluator);
  expectEqual(choices.length, 1);
  expectEqual(choices[0].text, 'Say nothing');
});
test('returns gated choice when prerequisites met', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  state.player.stats.charisma.value = 5;
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const choices = getAvailableChoices(gatedEvent, state, evaluator);
  expectEqual(choices.length, 2);
});

// ── getEventWithAvailableChoices ─────────────────────────────
console.log('\ngetEventWithAvailableChoices:');
test('returns null for missing event', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const result = getEventWithAvailableChoices({}, 'missing', state, evaluator);
  expectEqual(result, null);
});
test('returns event with filtered choices', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const result = getEventWithAvailableChoices(
    { greeting: simpleEvent },
    'greeting',
    state,
    evaluator
  );
  expectTrue(result !== null);
  expectEqual(result!.event.id, 'greeting');
  expectEqual(result!.available_choices.length, 2);
});

// ── resolveEventChoice ───────────────────────────────────────
console.log('\nresolveEventChoice:');
test('apffects effects for valid choice (choice 0)', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  const result = resolveEventChoice(simpleEvent, 0, stateManager, evaluator);

  expectTrue(result.success, `Expected success, got: ${result.reason}`);
  expectTrue(result.effects.some(e => e.kind === 'text' && e.detail === 'You wave. Sara waves back.'));
  expectTrue(result.effects.some(e => e.kind === 'npc_affection'));
  expectTrue(result.effects.some(e => e.kind === 'npc_flag_set'));

  // Verify state was mutated
  const npc = stateManager.getNPC('sara');
  expectEqual(npc.affection.value, 35); // 30 + 5
  expectEqual(npc.flags.greeted, true);
});

test('apffects effects for valid choice (choice 1)', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  const result = resolveEventChoice(simpleEvent, 1, stateManager, evaluator);

  expectTrue(result.success, `Expected success, got: ${result.reason}`);
  expectTrue(result.effects.some(e => e.kind === 'text' && e.detail === 'You look away.'));
  expectTrue(result.effects.some(e => e.kind === 'npc_affection'));

  const npc = stateManager.getNPC('sara');
  expectEqual(npc.affection.value, 25); // 30 - 5
  expectEqual(npc.flags.ignored, true);
});

test('fails for invalid choice index (negative)', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  const result = resolveEventChoice(simpleEvent, -1, stateManager, evaluator);

  expectEqual(result.success, false);
  expectTrue(result.reason!.includes('Invalid choice index'));
});

test('fails for invalid choice index (out of bounds)', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  const result = resolveEventChoice(simpleEvent, 99, stateManager, evaluator);

  expectEqual(result.success, false);
  expectTrue(result.reason!.includes('Invalid choice index'));
});

test('fails when prerequisites no longer met', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  // charisma is 2, choice 0 requires >= 3
  const result = resolveEventChoice(gatedEvent, 0, stateManager, evaluator);

  expectEqual(result.success, false);
  expectTrue(result.reason!.includes('prerequisites'));
});

test('succeeds for choice with no prerequisites', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  // choice 1 of gatedEvent has no prerequisites
  const result = resolveEventChoice(gatedEvent, 1, stateManager, evaluator);

  expectTrue(result.success, `Expected success, got: ${result.reason}`);
  expectTrue(result.effects.some(e => e.kind === 'text' && e.detail === 'You stare in silence.'));
});

test('apffects money delta in choice effects', () => {
  const event: Event = {
    id: 'bribe',
    text: 'A guard blocks your way.',
    choices: [
      {
        text: 'Pay $10',
        prerequisites: null,
        effects: {
          text: 'The guard steps aside.',
          text_key: null,
          scene_id: null,
          stat_bumps: null,
          npc_effects: null,
          money_delta: -10,
          player_flags: null,
          global_emissions: null,
          item_grants: null,
          item_consumes: null,
          quest_triggers: null,
          event_id: null,
          event_probability: null,
        },
      },
    ],
  };

  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  const result = resolveEventChoice(event, 0, stateManager, evaluator);

  expectTrue(result.success, `Expected success, got: ${result.reason}`);
  expectTrue(result.effects.some(e => e.kind === 'money_delta'));
  expectEqual(stateManager.getPlayer().economy.balance, 40); // 50 - 10
});

test('fails when insufficient funds for money_delta cost', () => {
  const event: Event = {
    id: 'expensive_bribe',
    text: 'A guard blocks your way.',
    choices: [
      {
        text: 'Pay $100',
        prerequisites: null,
        effects: {
          text: 'The guard steps aside.',
          text_key: null,
          scene_id: null,
          stat_bumps: null,
          npc_effects: null,
          money_delta: -100,
          player_flags: null,
          global_emissions: null,
          item_grants: null,
          item_consumes: null,
          quest_triggers: null,
          event_id: null,
          event_probability: null,
        },
      },
    ],
  };

  const state = JSON.parse(JSON.stringify(baseState));
  const stateManager = new StateManager(state);
  const evaluator = new ConditionEvaluator(emptyLibrary);

  const result = resolveEventChoice(event, 0, stateManager, evaluator);

  expectEqual(result.success, false);
  expectTrue(result.reason!.includes('Insufficient funds'));
});

// ── evaluateLocationEventTrigger ─────────────────────────────
console.log('\nevaluateLocationEventTrigger:');
test('returns null for empty triggers', () => {
  const result = evaluateLocationEventTrigger([]);
  expectEqual(result, null);
});
test('returns null for null triggers', () => {
  const result = evaluateLocationEventTrigger(null);
  expectEqual(result, null);
});
test('returns event_id for trigger with probability 1.0', () => {
  // Math.random() < 1.0 is always true
  const result = evaluateLocationEventTrigger([
    { event_id: 'test_event', probability: 1.0 },
  ]);
  expectEqual(result, 'test_event');
});

// ── evaluateActionEventTrigger ───────────────────────────────
console.log('\nevaluateActionEventTrigger:');
test('returns null when no event_id', () => {
  const result = evaluateActionEventTrigger({
    text: null, text_key: null, scene_id: null, stat_bumps: null,
    npc_effects: null, money_delta: null, player_flags: null,
    global_emissions: null, item_grants: null, item_consumes: null,
    quest_triggers: null, event_id: null, event_probability: null,
  });
  expectEqual(result, null);
});
test('returns event_id with probability 1.0', () => {
  const result = evaluateActionEventTrigger({
    text: null, text_key: null, scene_id: null, stat_bumps: null,
    npc_effects: null, money_delta: null, player_flags: null,
    global_emissions: null, item_grants: null, item_consumes: null,
    quest_triggers: null, event_id: 'test_event', event_probability: 1.0,
  });
  expectEqual(result, 'test_event');
});

// ── resolveEventPriority ─────────────────────────────────────
console.log('\nresolveEventPriority:');
test('quest > action > location', () => {
  expectEqual(resolveEventPriority('quest_event', 'action_event', 'loc_event'), 'quest_event');
});
test('action > location when no quest', () => {
  expectEqual(resolveEventPriority(null, 'action_event', 'loc_event'), 'action_event');
});
test('location when no quest or action', () => {
  expectEqual(resolveEventPriority(null, null, 'loc_event'), 'loc_event');
});
test('null when all null', () => {
  expectEqual(resolveEventPriority(null, null, null), null);
});

// ── Event chaining (choice → follow-up event) ────────────────
// The console composes chaining as:
//   nextId = evaluateActionEventTrigger(chosenChoice.effects)
//   if (nextId) enterEventMode(nextId)  // -> loadEvent(nextId)
// These tests verify that composition against the real helpers.
console.log('\nEvent chaining:');

const firstEvent: Event = {
  id: 'chain_first',
  text: 'A door stands ajar.',
  choices: [
    {
      text: 'Step through',
      prerequisites: null,
      effects: {
        text: 'You cross the threshold.',
        text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
        money_delta: null, player_flags: null, global_emissions: null,
        item_grants: null, item_consumes: null, quest_triggers: null,
        event_id: 'chain_second', event_probability: 1.0,
      },
    },
    {
      text: 'Walk away',
      prerequisites: null,
      effects: {
        text: 'You leave it be.',
        text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
        money_delta: null, player_flags: null, global_emissions: null,
        item_grants: null, item_consumes: null, quest_triggers: null,
        event_id: null, event_probability: null,
      },
    },
  ],
};

const secondEvent: Event = {
  id: 'chain_second',
  text: 'Beyond the door, a figure waits.',
  choices: [
    {
      text: 'Greet them',
      prerequisites: null,
      effects: {
        text: 'You nod.',
        text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
        money_delta: null, player_flags: null, global_emissions: null,
        item_grants: null, item_consumes: null, quest_triggers: null,
        event_id: null, event_probability: null,
      },
    },
  ],
};

const chainRegistry: Record<string, Event> = {
  chain_first: firstEvent,
  chain_second: secondEvent,
};

test('choice with event_id + prob 1.0 chains to follow-up event', () => {
  const sm = new StateManager(JSON.parse(JSON.stringify(baseState)));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const result = resolveEventChoice(firstEvent, 0, sm, evaluator);
  expectTrue(result.success);
  const nextId = evaluateActionEventTrigger(firstEvent.choices[0].effects);
  expectEqual(nextId, 'chain_second');
  expectTrue(loadEvent(chainRegistry, nextId!) !== null);
});

test('choice without event_id does not chain', () => {
  const nextId = evaluateActionEventTrigger(firstEvent.choices[1].effects);
  expectEqual(nextId, null);
});

test('chained follow-up event exposes its own choices', () => {
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const next = getEventWithAvailableChoices(
    chainRegistry, 'chain_second', JSON.parse(JSON.stringify(baseState)), evaluator
  );
  expectTrue(next !== null);
  expectEqual(next!.available_choices.length, 1);
});

test('chain to unknown event_id resolves to null (no crash)', () => {
  expectEqual(loadEvent(chainRegistry, 'nonexistent_event'), null);
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
