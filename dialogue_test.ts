// ============================================================
// dialogue_test.ts — Tests for the dialogue graph system
// Run with: npx ts-node dialogue_test.ts
// ============================================================

import {
  loadDialogue,
  resolveActiveNode,
  getAvailableResponses,
  enterNode,
  resolveDialogueChoice,
} from './dialogue';
import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { Dialogue, GameState } from './types';

// ── Test State ───────────────────────────────────────────────

const baseState: GameState = {
  npcs: {
    alex: {
      id: 'alex',
      name: 'Alex',
      affection: { value: 20, high_threshold: 50 },
      corruption: { value: 10, high_threshold: 50 },
      traits: {},
      daily_counters: {},
      flags: { met_player: true },
      locations: [{ location_id: 'bar', conditions: null }],
    },
  },
  player: {
    stats: {
      charisma: { value: 2, max: 10, thresholds: [] },
      intelligence: { value: 1, max: 10, thresholds: [] },
    },
    skills: {},
    inventory: { consumables: {}, key_items: {}, gifts: {} },
    economy: { balance: 50, weekly_income: 50, income_upgrade_cost: 200, income_max: 200 },
    daily_counters: {},
    flags: {},
  },
  global: {
    current_location_id: 'bar',
    previous_location_id: null,
    world_phase: { current: 1, phases: [] },
    flags: {},
    day: { count: 1, week_count: 0, day_of_week: 0, rested: false },
    overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
    quest_states: {},
    unlocked_locations: ['bar'],
    unlocked_shops: [],
    session: { game_version: '0.1.0', save_timestamp: '', playtime: 0 },
  },
  items: {},
  shops: {},
  quests: {},
} as unknown as GameState;

const emptyLibrary = { conditions: {} };

const noEffects = {
  text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
  money_delta: null, player_flags: null, global_emissions: null,
  item_grants: null, item_consumes: null, quest_triggers: null,
  event_id: null, event_probability: null,
};

// ── Test Dialogue ────────────────────────────────────────────
// Root auto-routes: if alex corruption >= 50 -> "dark_greeting",
// otherwise falls through to the plain root text.

const dialogue: Dialogue = {
  id: 'alex_chat',
  npc_id: 'alex',
  root_node_id: 'root',
  nodes: {
    root: {
      id: 'root',
      text: 'Alex looks up. "Oh, it\'s you."',
      speaker: null,
      routes: [
        {
          conditions: [
            { inline: { type: 'npc_stat', target_id: 'alex:corruption', operator: 'gte', value: 50 } },
          ],
          target_node_id: 'dark_greeting',
        },
      ],
      choices: [
        { text: 'Say hi', prerequisites: null, effects: { ...noEffects }, next_node_id: 'smalltalk' },
        {
          text: 'Flatter him (charisma >= 2)',
          prerequisites: [
            { inline: { type: 'player_stat', target_id: 'charisma', operator: 'gte', value: 2 } },
          ],
          effects: { ...noEffects, npc_effects: { npc_id: 'alex', affection: 5, corruption: null, trait_bumps: null, flags: null } },
          next_node_id: 'smalltalk',
        },
        {
          text: 'Impossible flattery (charisma >= 99)',
          prerequisites: [
            { inline: { type: 'player_stat', target_id: 'charisma', operator: 'gte', value: 99 } },
          ],
          effects: { ...noEffects },
          next_node_id: 'smalltalk',
        },
      ],
    },
    dark_greeting: {
      id: 'dark_greeting',
      text: 'Alex smirks coldly. "Back for more?"',
      speaker: null,
      routes: null,
      choices: [
        { text: 'Leave', prerequisites: null, effects: { ...noEffects }, next_node_id: null },
      ],
    },
    smalltalk: {
      id: 'smalltalk',
      text: 'You chat about nothing in particular.',
      speaker: null,
      routes: null,
      choices: [
        { text: 'End conversation', prerequisites: null, effects: { ...noEffects }, next_node_id: null },
      ],
    },
  },
};

// Dialogue with a cyclic route to exercise the depth guard.
const cyclicDialogue: Dialogue = {
  id: 'loop',
  npc_id: 'alex',
  root_node_id: 'a',
  nodes: {
    a: { id: 'a', text: 'A', speaker: null, routes: [{ conditions: [], target_node_id: 'b' }], choices: [] },
    b: { id: 'b', text: 'B', speaker: null, routes: [{ conditions: [], target_node_id: 'a' }], choices: [] },
  },
};

const registry: Record<string, Dialogue> = { alex_chat: dialogue, loop: cyclicDialogue };

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
  if (!actual) {
    throw new Error(msg || `Expected true, got ${actual}`);
  }
}

// ── loadDialogue ─────────────────────────────────────────────
console.log('\nloadDialogue:');
test('returns dialogue for known id', () => {
  expectTrue(loadDialogue(registry, 'alex_chat') !== null);
});
test('returns null for unknown id', () => {
  expectEqual(loadDialogue(registry, 'nope'), null);
});

// ── Conditional auto-routing ─────────────────────────────────
console.log('\nConditional auto-routing:');
test('stays on root when route conditions fail (corruption low)', () => {
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const node = resolveActiveNode(dialogue, 'root', baseState, evaluator);
  expectEqual(node!.id, 'root');
});
test('auto-routes to dark_greeting when corruption high', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  state.npcs.alex.corruption.value = 60;
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const node = resolveActiveNode(dialogue, 'root', state, evaluator);
  expectEqual(node!.id, 'dark_greeting');
});
test('depth guard prevents infinite route loop', () => {
  const evaluator = new ConditionEvaluator(emptyLibrary);
  // Should terminate (return a node) rather than hang.
  const node = resolveActiveNode(cyclicDialogue, 'a', baseState, evaluator);
  expectTrue(node !== null);
});

// ── Response filtering ───────────────────────────────────────
console.log('\nResponse filtering:');
test('gated response hidden when prereq fails', () => {
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const responses = getAvailableResponses(dialogue.nodes.root, baseState, evaluator);
  // "Say hi" + "Flatter him" (charisma 2 >= 2) available; impossible one hidden.
  expectEqual(responses.length, 2);
});
test('gated response shown when prereq passes', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  state.player.stats.charisma.value = 99;
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const responses = getAvailableResponses(dialogue.nodes.root, state, evaluator);
  expectEqual(responses.length, 3);
});

// ── enterNode ────────────────────────────────────────────────
console.log('\nenterNode:');
test('enterNode resolves routing + returns available responses', () => {
  const state = JSON.parse(JSON.stringify(baseState));
  state.npcs.alex.corruption.value = 60;
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const entered = enterNode(dialogue, 'root', state, evaluator);
  expectEqual(entered!.node.id, 'dark_greeting');
  expectEqual(entered!.available_responses.length, 1);
});
test('enterNode returns null for missing node', () => {
  const evaluator = new ConditionEvaluator(emptyLibrary);
  expectEqual(enterNode(dialogue, 'ghost', baseState, evaluator), null);
});

// ── resolveDialogueChoice ────────────────────────────────────
console.log('\nresolveDialogueChoice:');
test('valid choice succeeds and returns next_node_id', () => {
  const sm = new StateManager(JSON.parse(JSON.stringify(baseState)));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const result = resolveDialogueChoice(dialogue.nodes.root, 0, sm, evaluator);
  expectTrue(result.success);
  expectEqual(result.next_node_id, 'smalltalk');
});
test('choice effects applied (affection bump)', () => {
  const sm = new StateManager(JSON.parse(JSON.stringify(baseState)));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  resolveDialogueChoice(dialogue.nodes.root, 1, sm, evaluator);  // Flatter him: +5 affection
  expectEqual(sm.getState().npcs.alex.affection.value, 25);
});
test('next_node_id null ends conversation', () => {
  const sm = new StateManager(JSON.parse(JSON.stringify(baseState)));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const result = resolveDialogueChoice(dialogue.nodes.smalltalk, 0, sm, evaluator);
  expectTrue(result.success);
  expectEqual(result.next_node_id, null);
});
test('invalid choice index fails gracefully', () => {
  const sm = new StateManager(JSON.parse(JSON.stringify(baseState)));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  const result = resolveDialogueChoice(dialogue.nodes.root, 99, sm, evaluator);
  expectEqual(result.success, false);
  expectEqual(result.next_node_id, null);
});
test('choice with unmet prereq is rejected', () => {
  const sm = new StateManager(JSON.parse(JSON.stringify(baseState)));
  const evaluator = new ConditionEvaluator(emptyLibrary);
  // index 2 = "Impossible flattery (charisma >= 99)"; base charisma is 2.
  const result = resolveDialogueChoice(dialogue.nodes.root, 2, sm, evaluator);
  expectEqual(result.success, false);
  expectEqual(result.next_node_id, null);
});

// ── Summary ──────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
