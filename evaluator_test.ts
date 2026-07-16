// ============================================================
// evaluator.test.ts — Tests for the condition evaluator
// Run with: npx ts-node src/engine/evaluator.test.ts
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { ConditionLibrary, GameState } from './types';

// ── Test State ───────────────────────────────────────────────

const testState: GameState = {
  npcs: {
    sara: {
      id: 'sara',
      name: 'Sara',
      locations: [{ location_id: 'park', conditions: null }],
      affection: { value: 55, high_threshold: 50 },
      corruption: { value: 20, high_threshold: 50 },
      traits: {
        exhibitionism: {
          unlocked: true,
          current_tier: 1,
          tiers: [
            { value: 30, cap: 100 },
            { value: 0, cap: 100 }
          ]
        }
      },
      daily_counters: {
        interactions: { current: 2, max: 3 }
      },
      flags: {
        met_player: true,
        gave_flower: false
      }
    }
  },
  player: {
    stats: {
      charisma: { value: 3, max: 10, thresholds: [] },
      strength: { value: 1, max: 10, thresholds: [] }
    },
    skills: {
      lockpicking: {
        unlocked: true,
        unlock_conditions: [],
        current_tier: 2,
        tiers: [
          { value: 0, cap: 100, advance_conditions: null },
          { value: 0, cap: 100, advance_conditions: null },
          { value: 0, cap: 100, advance_conditions: null }
        ]
      },
      persuasion: {
        unlocked: false,
        unlock_conditions: [],
        current_tier: 0,
        tiers: [{ value: 0, cap: 100, advance_conditions: null }]
      }
    },
    inventory: {
      consumables: { energy_drink: { quantity: 2 } },
      key_items:   { rusty_key: true, mysterious_amulet: false },
      gifts:       { chocolate_box: { quantity: 3 } }
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
    flags: {
      completed_tutorial: true
    }
  },
  global: {
    current_location_id: 'home',
    previous_location_id: 'park',
    world_phase: { current: 2, phases: [] },
    flags: {
      town_notice_board_read: true
    },
    day: { count: 14, week_count: 2, day_of_week: 0, rested: false },
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
      },
      sara_quest_1: {
        quest_id: 'sara_quest_1',
        current_stage_index: 0,
        started_at: { day: 3, phase: 1 },
        stage_started_at: { day: 3, phase: 1 },
        completed: false,
        failed: false
      },
      secret_club: {
        quest_id: 'secret_club',
        current_stage_index: 0,
        started_at: { day: 1, phase: 1 },
        stage_started_at: { day: 1, phase: 1 },
        completed: false,
        failed: false
      }
    },
    unlocked_locations: ['home', 'park', 'downtown', 'city_hall'],
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

// ── Named Condition Library ──────────────────────────────────

const library: ConditionLibrary = {
  conditions: {
    sara_affection_high: {
      type: 'npc_stat',
      target_id: 'sara:affection',
      operator: 'gte',
      value: 50
    },
    player_charisma_3: {
      type: 'player_stat',
      target_id: 'charisma',
      operator: 'gte',
      value: 3
    },
    phase_2_or_higher: {
      type: 'world_phase',
      operator: 'gte',
      value: 2
    }
  }
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

function expect(actual: boolean, expected: boolean, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg ?? `Expected ${expected}, got ${actual}`);
  }
}

// ── Tests ────────────────────────────────────────────────────

const evaluator = new ConditionEvaluator(library);

console.log('\nCondition Evaluator Tests\n');

// Named references
console.log('Named condition references:');
test('sara affection high — passes (value 55 >= 50)', () => {
  expect(evaluator.evaluate({ ref: 'sara_affection_high' }, testState), true);
});
test('player charisma 3 — passes (value 3 >= 3)', () => {
  expect(evaluator.evaluate({ ref: 'player_charisma_3' }, testState), true);
});
test('phase 2 or higher — passes (phase is 2)', () => {
  expect(evaluator.evaluate({ ref: 'phase_2_or_higher' }, testState), true);
});

// NPC stats
console.log('\nNPC stat conditions:');
test('sara corruption below threshold — passes (20 < 50)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_stat', target_id: 'sara:corruption', operator: 'lt', value: 50 }
  }, testState), true);
});
test('sara affection eq 55 — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_stat', target_id: 'sara:affection', operator: 'eq', value: 55 }
  }, testState), true);
});
test('sara affection eq 99 — fails', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_stat', target_id: 'sara:affection', operator: 'eq', value: 99 }
  }, testState), false);
});

// NPC flags
console.log('\nNPC flag conditions:');
test('sara met_player flag — passes (true)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_flag', target_id: 'sara:met_player', operator: 'has', value: null }
  }, testState), true);
});
test('sara gave_flower flag — fails (false)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_flag', target_id: 'sara:gave_flower', operator: 'has', value: null }
  }, testState), false);
});

// NPC traits
console.log('\nNPC trait conditions:');
test('sara exhibitionism tier >= 1 — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_trait', target_id: 'sara:exhibitionism', operator: 'gte', value: 1 }
  }, testState), true);
});
test('sara exhibitionism tier >= 2 — fails (only tier 1)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'npc_trait', target_id: 'sara:exhibitionism', operator: 'gte', value: 2 }
  }, testState), false);
});

// Player stats and skills
console.log('\nPlayer stat/skill conditions:');
test('player strength < 2 — passes (value 1)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_stat', target_id: 'strength', operator: 'lt', value: 2 }
  }, testState), true);
});
test('player lockpicking tier >= 2 — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_skill', target_id: 'lockpicking', operator: 'gte', value: 2 }
  }, testState), true);
});
test('player persuasion — fails (not unlocked)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_skill', target_id: 'persuasion', operator: 'gte', value: 1 }
  }, testState), false);
});

// Inventory
console.log('\nInventory conditions:');
test('player has rusty_key — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_inventory', target_id: 'rusty_key', operator: 'has', value: null }
  }, testState), true);
});
test('player has mysterious_amulet — fails (false)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_inventory', target_id: 'mysterious_amulet', operator: 'has', value: null }
  }, testState), false);
});
test('player has energy_drink — passes (qty 2)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_inventory', target_id: 'energy_drink', operator: 'has', value: null }
  }, testState), true);
});
test('player has chocolate_box qty >= 3 — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'player_inventory', target_id: 'chocolate_box', operator: 'gte', value: 3 }
  }, testState), true);
});

// Quest states
console.log('\nQuest state conditions:');
test('intro_quest completed — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'quest_state', target_id: 'intro_quest', operator: 'eq', value: true }
  }, testState), true);
});
test('sara_quest_1 active — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'quest_state', target_id: 'sara_quest_1', operator: 'eq', value: false }
  }, testState), true);
});
test('secret_club not completed — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'quest_state', target_id: 'secret_club', operator: 'eq', value: false }
  }, testState), true);
});

// Global flags and world phase
console.log('\nGlobal state conditions:');
test('world phase >= 2 — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'world_phase', operator: 'gte', value: 2 }
  }, testState), true);
});
test('world phase >= 3 — fails (phase is 2)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'world_phase', operator: 'gte', value: 3 }
  }, testState), false);
});
test('global flag town_notice_board_read — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'global_flag', target_id: 'town_notice_board_read', operator: 'has', value: null }
  }, testState), true);
});
test('day count >= 10 — passes (day 14)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'day_count', operator: 'gte', value: 10 }
  }, testState), true);
});

// Location unlocks
console.log('\nLocation conditions:');
test('home unlocked — passes', () => {
  expect(evaluator.evaluate({
    inline: { type: 'location_unlocked', target_id: 'home', operator: 'eq', value: true }
  }, testState), true);
});
test('secret_nightclub unlocked — fails', () => {
  expect(evaluator.evaluate({
    inline: { type: 'location_unlocked', target_id: 'secret_nightclub', operator: 'eq', value: true }
  }, testState), false);
});

// Daily counters
console.log('\nDaily counter conditions:');
test('sara interactions has remaining uses — passes (1 remaining)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'daily_counter', target_id: 'npc:sara:interactions', operator: 'gte', value: 1 }
  }, testState), true);
});
test('player job has remaining uses — fails (exhausted)', () => {
  expect(evaluator.evaluate({
    inline: { type: 'daily_counter', target_id: 'player:job', operator: 'gte', value: 1 }
  }, testState), false);
});

// Logical expressions
console.log('\nLogical expressions:');
test('AND — sara affection high AND phase >= 2 — passes', () => {
  expect(evaluator.evaluate({
    inline: {
      operator: 'AND',
      operands: [
        { type: 'npc_stat', target_id: 'sara:affection', operator: 'gte', value: 50 },
        { type: 'world_phase', operator: 'gte', value: 2 }
      ]
    }
  }, testState), true);
});
test('AND — sara affection high AND phase >= 3 — fails', () => {
  expect(evaluator.evaluate({
    inline: {
      operator: 'AND',
      operands: [
        { type: 'npc_stat', target_id: 'sara:affection', operator: 'gte', value: 50 },
        { type: 'world_phase', operator: 'gte', value: 3 }
      ]
    }
  }, testState), false);
});
test('OR — phase >= 3 OR sara affection high — passes (second true)', () => {
  expect(evaluator.evaluate({
    inline: {
      operator: 'OR',
      operands: [
        { type: 'world_phase', operator: 'gte', value: 3 },
        { type: 'npc_stat', target_id: 'sara:affection', operator: 'gte', value: 50 }
      ]
    }
  }, testState), true);
});
test('NOT — NOT phase >= 3 — passes (phase is 2)', () => {
  expect(evaluator.evaluate({
    inline: {
      operator: 'NOT',
      operands: [
        { type: 'world_phase', operator: 'gte', value: 3 }
      ]
    }
  }, testState), true);
});
test('Nested — (sara affection high AND phase >= 2) OR has amulet — passes', () => {
  expect(evaluator.evaluate({
    inline: {
      operator: 'OR',
      operands: [
        {
          operator: 'AND',
          operands: [
            { type: 'npc_stat', target_id: 'sara:affection', operator: 'gte', value: 50 },
            { type: 'world_phase', operator: 'gte', value: 2 }
          ]
        },
        { type: 'player_inventory', target_id: 'mysterious_amulet', operator: 'has', value: null }
      ]
    }
  }, testState), true);
});

// Mixed named + inline
console.log('\nMixed named + inline references:');
test('AND with named ref + inline — passes', () => {
  expect(evaluator.evaluate({
    inline: {
      operator: 'AND',
      operands: [
        // This uses a named ref embedded in an expression
        // We resolve manually here since expressions take Condition | ConditionExpression
        // Named refs in expressions are resolved at the ConditionReference level
        { type: 'npc_stat', target_id: 'sara:affection', operator: 'gte', value: 50 },
        { type: 'player_stat', target_id: 'charisma', operator: 'gte', value: 3 }
      ]
    }
  }, testState), true);
});

// evaluateAll and evaluateAny helpers
console.log('\nevaluateAll / evaluateAny helpers:');
test('evaluateAll — all pass', () => {
  expect(evaluator.evaluateAll([
    { ref: 'sara_affection_high' },
    { ref: 'phase_2_or_higher' }
  ], testState), true);
});
test('evaluateAll — one fails', () => {
  expect(evaluator.evaluateAll([
    { ref: 'sara_affection_high' },
    { inline: { type: 'world_phase', operator: 'gte', value: 3 } }
  ], testState), false);
});
test('evaluateAny — one passes', () => {
  expect(evaluator.evaluateAny([
    { inline: { type: 'world_phase', operator: 'gte', value: 3 } },
    { ref: 'sara_affection_high' }
  ], testState), true);
});
test('evaluateAny — none pass', () => {
  expect(evaluator.evaluateAny([
    { inline: { type: 'world_phase', operator: 'gte', value: 3 } },
    { inline: { type: 'player_stat', target_id: 'strength', operator: 'gte', value: 10 } }
  ], testState), false);
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
