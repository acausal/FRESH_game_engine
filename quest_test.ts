// ============================================================
// quest.test.ts — Tests for the quest evaluation system
// Run with: npx ts-node src/engine/quest.test.ts
// ============================================================

import { QuestManager } from './quest';
import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import {
  Quest,
  GameState,
  ConditionLibrary,
} from './types';

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

function expectTrue(val: any, msg?: string)  { expect(!!val, true, msg); }
function expectFalse(val: any, msg?: string) { expect(!!val, false, msg); }

// ── Test Data Factories ──────────────────────────────────────

function makeQuest(overrides: Partial<Quest> = {}): Quest {
  return {
    id: 'test_quest',
    name: 'Test Quest',
    description: 'A test quest for unit testing.',
    visibility: { conditions: null },
    auto_start: { conditions: null },
    stages: [
      {
        id: 'stage_1',
        description: 'Complete the first objective.',
        completion_conditions: [
          { inline: { type: 'player_flag', target_id: 'stage_1_done', operator: 'has', value: null } }
        ],
        on_complete: {
          text: 'Stage 1 complete!',
          text_key: null,
          scene_id: null,
          stat_bumps: { stat_id: 'charisma', value: 1 },
          npc_effects: null,
          money_delta: 10,
          player_flags: { quest_stage_1_complete: true },
          global_emissions: null,
          item_grants: null,
          item_consumes: null,
          quest_triggers: null,
          event_id: null,
          event_probability: null,
        },
        on_complete_event_id: null,
        fail_conditions: null,
      },
      {
        id: 'stage_2',
        description: 'Complete the final objective.',
        completion_conditions: [
          { inline: { type: 'player_flag', target_id: 'stage_2_done', operator: 'has', value: null } }
        ],
        on_complete: {
          text: 'Quest complete!',
          text_key: null,
          scene_id: null,
          stat_bumps: null,
          npc_effects: { npc_id: 'sara', affection: 5, corruption: null, trait_bumps: null, flags: null },
          money_delta: null,
          player_flags: { quest_complete: true },
          global_emissions: [{ flag: 'test_quest_finished', value: true }],
          item_grants: null,
          item_consumes: null,
          quest_triggers: null,
          event_id: null,
          event_probability: null,
        },
        on_complete_event_id: null,
        fail_conditions: null,
      }
    ],
    ...overrides,
  };
}

function makeState(questOverrides: Partial<Quest> = {}): GameState {
  const quest = makeQuest(questOverrides);
  return {
    npcs: {
      sara: {
        id: 'sara',
        name: 'Sara',
        locations: [{ location_id: 'park', conditions: null }],
        affection: { value: 30, high_threshold: 50 },
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
        consumables: {},
        key_items: {},
        gifts: {}
      },
      economy: {
        balance: 100,
        weekly_income: 50,
        income_upgrade_cost: 200,
        income_max: 200
      },
      daily_counters: {},
      flags: {}
    },
    global: {
      current_location_id: 'home',
      previous_location_id: null,
      world_phase: { current: 1, phases: [] },
      flags: {},
      day: { count: 5, week_count: 0, day_of_week: 5, rested: false },
      overnight_eval: {
        pending_notifications: [],
        phase_check: false,
        npc_breakthrough_check: false
      },
      quest_states: {
        test_quest: {
          quest_id: 'test_quest',
          current_stage_index: 0,
          started_at: { day: 0, phase: 0 },
          stage_started_at: { day: 0, phase: 0 },
          completed: false,
          failed: false
        }
      },
      unlocked_locations: ['home'],
      unlocked_shops: [],
      session: { game_version: '0.1.0', save_timestamp: '', playtime: 0 }
    },
    items: {},
    shops: {},
    quests: { test_quest: quest }
  };
}

const library: ConditionLibrary = { conditions: {} };
const evaluator = new ConditionEvaluator(library);

// ── Tests ────────────────────────────────────────────────────

console.log('\nQuest Evaluation Tests\n');

// ── Initiation Tests ─────────────────────────────────────────

console.log('Quest Initiation:');

test('quest not started by default', () => {
  const state = makeState();
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateAfterAction([], sm, evaluator);
  expect(result.initiations.length, 0);
});

test('quest initiates when triggered by action', () => {
  const state = makeState();
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateAfterAction(['test_quest'], sm, evaluator);
  expect(result.initiations.length, 1);
  expectTrue(result.initiations[0].success);
  expect(result.initiations[0].quest_id, 'test_quest');
});

test('quest initiates via auto_start conditions', () => {
  const state = makeState({
    auto_start: {
      conditions: [
        { inline: { type: 'day_count', operator: 'gte', value: 5 } }
      ]
    }
  });
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateDuringRestCycle(sm, evaluator);
  expect(result.initiations.length, 1);
  expectTrue(result.initiations[0].success);
});

test('quest does not auto-start when conditions not met', () => {
  const state = makeState({
    auto_start: {
      conditions: [
        { inline: { type: 'day_count', operator: 'gte', value: 10 } }
      ]
    }
  });
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateDuringRestCycle(sm, evaluator);
  expect(result.initiations.length, 0);
});

// ── Stage Completion Tests ───────────────────────────────────

console.log('\nStage Completion:');

test('stage completes when conditions met', () => {
  const state = makeState();
  state.global.quest_states.test_quest.started_at = { day: 1, phase: 1 };
  state.player.flags['stage_1_done'] = true;

  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateAfterAction([], sm, evaluator);

  expect(result.completions.length, 1);
  expectTrue(result.completions[0].success);
  expect(result.completions[0].quest_complete, false);
  expect(result.completions[0].next_stage_description, 'Complete the final objective.');
});

test('stage rewards applied on completion', () => {
  const state = makeState();
  state.global.quest_states.test_quest.started_at = { day: 1, phase: 1 };
  state.player.flags['stage_1_done'] = true;

  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  qm.evaluateAfterAction([], sm, evaluator);

  // Money reward: +10
  expect(sm.getState().player.economy.balance, 110);
  // Player flag set
  expectTrue(sm.getState().player.flags['quest_stage_1_complete']);
  // Stat bump: charisma +1
  expect(sm.getState().player.stats.charisma.value, 4);
});

test('final stage completes quest', () => {
  const state = makeState();
  state.global.quest_states.test_quest.started_at = { day: 1, phase: 1 };
  state.global.quest_states.test_quest.current_stage_index = 1;
  state.player.flags['stage_2_done'] = true;

  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateAfterAction([], sm, evaluator);

  expect(result.completions.length, 1);
  expectTrue(result.completions[0].quest_complete);
  expectTrue(sm.getState().global.quest_states.test_quest.completed);
});

test('final stage rewards include NPC effects and global emissions', () => {
  const state = makeState();
  state.global.quest_states.test_quest.started_at = { day: 1, phase: 1 };
  state.global.quest_states.test_quest.current_stage_index = 1;
  state.player.flags['stage_2_done'] = true;

  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  qm.evaluateAfterAction([], sm, evaluator);

  // NPC affection +5
  expect(sm.getState().npcs.sara.affection.value, 35);
  // Player flag set
  expectTrue(sm.getState().player.flags['quest_complete']);
  // Global emission
  expectTrue(sm.getState().global.flags['test_quest_finished']);
});

test('stage without completion conditions auto-completes on final stage', () => {
  const state = makeState({
    stages: [
      {
        id: 'auto_complete_stage',
        description: 'This auto-completes.',
        completion_conditions: null,
        on_complete: {
          text: 'Auto-completed!',
          text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
          money_delta: null, player_flags: null, global_emissions: null,
          item_grants: null, item_consumes: null, quest_triggers: null,
          event_id: null, event_probability: null,
        },
        on_complete_event_id: null,
        fail_conditions: null,
      }
    ]
  });
  state.global.quest_states.test_quest.started_at = { day: 1, phase: 1 };

  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateAfterAction([], sm, evaluator);

  expect(result.completions.length, 1);
  expectTrue(result.completions[0].quest_complete);
});

// ── Failure Tests ────────────────────────────────────────────

console.log('\nQuest Failure:');

test('quest fails when fail conditions met', () => {
  const state = makeState({
    stages: [
      {
        id: 'stage_fail',
        description: 'This stage can fail.',
        completion_conditions: null,
        on_complete: null,
        on_complete_event_id: null,
        fail_conditions: [
          { inline: { type: 'player_flag', target_id: 'quest_failed', operator: 'has', value: null } }
        ],
      }
    ]
  });
  state.global.quest_states.test_quest.started_at = { day: 1, phase: 1 };
  state.player.flags['quest_failed'] = true;

  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateAfterAction([], sm, evaluator);

  expect(result.failures.length, 1);
  expectTrue(sm.getState().global.quest_states.test_quest.failed);
});

// ── Integration Tests ────────────────────────────────────────

console.log('\nIntegration:');

test('end-to-end: trigger → initiate → stage 1 → stage 2 → complete', () => {
  const state = makeState();
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);

  // Step 1: Trigger quest
  let result = qm.evaluateAfterAction(['test_quest'], sm, evaluator);
  expect(result.initiations.length, 1);
  expectTrue(result.initiations[0].success);

  // Verify quest started
  expectTrue(sm.getState().global.quest_states.test_quest.started_at.day > 0);

  // Step 2: Complete stage 1
  sm.setPlayerFlag('stage_1_done', true);
  result = qm.evaluateAfterAction([], sm, evaluator);
  expect(result.completions.length, 1);
  expectFalse(result.completions[0].quest_complete ?? true);

  // Verify stage advanced
  expect(sm.getState().global.quest_states.test_quest.current_stage_index, 1);

  // Step 3: Complete stage 2 (final)
  sm.setPlayerFlag('stage_2_done', true);
  result = qm.evaluateAfterAction([], sm, evaluator);
  expect(result.completions.length, 1);
  expectTrue(result.completions[0].quest_complete ?? false);

  // Verify quest completed
  expectTrue(sm.getState().global.quest_states.test_quest.completed);
});

test('display statuses returns correct quest states', () => {
  const state = makeState();
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);

  const statuses = qm.getDisplayStatuses(sm.getState());
  expect(statuses.length, 1);
  expect(statuses[0].status, 'not_started');
  expect(statuses[0].total_stages, 2);

  // Start the quest
  qm.evaluateAfterAction(['test_quest'], sm, evaluator);
  const activeStatuses = qm.getDisplayStatuses(sm.getState());
  expect(activeStatuses[0].status, 'active');
  expect(activeStatuses[0].stage_index, 0);
});

// ── Rest Cycle Integration ─────────────────────────────────

console.log('\nRest Cycle Integration:');

test('rest cycle evaluates auto-start quests', () => {
  const state = makeState({
    auto_start: {
      conditions: [
        { inline: { type: 'day_count', operator: 'gte', value: 5 } }
      ]
    }
  });
  const sm = new StateManager(state);
  const qm = new QuestManager(state.quests);
  const result = qm.evaluateDuringRestCycle(sm, evaluator);

  expect(result.initiations.length, 1);
  expectTrue(result.initiations[0].success);
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
