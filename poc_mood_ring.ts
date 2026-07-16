// ============================================================
// poc_mood_ring.ts — Minigame POC #9 (throwaway)
// Validates: dialogue routing BREADTH — a single NPC greets the
// player differently across many world states (day/corruption/flags)
// via conditional auto-routes from the root node, with a fallthrough.
// Drives REAL dialogue.ts. Does NOT touch data/ fixtures.
// Run: npx ts-node poc_mood_ring.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { enterNode } from './dialogue';
import { Dialogue, GameState, ActionEffects } from './types';

const NO_EFFECTS: ActionEffects = {
  text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
  money_delta: null, player_flags: null, global_emissions: null,
  item_grants: null, item_consumes: null, quest_triggers: null,
  event_id: null, event_probability: null,
};

const dialogue = {
  id: 'mood_ring_poc',
  npc_id: 'mira',
  root_node_id: 'greeting',
  nodes: {
    greeting: {
      id: 'greeting',
      text: 'Mira is here.',
      speaker: 'Mira',
      routes: [
        { conditions: [{ inline: { type: 'player_flag', target_id: 'knew_secret', operator: 'has' } }], target_node_id: 'greet_secret' },
        { conditions: [{ inline: { type: 'player_stat', target_id: 'corruption', operator: 'gte', value: 60 } }], target_node_id: 'greet_corrupt' },
        { conditions: [{ inline: { type: 'player_stat', target_id: 'corruption', operator: 'gte', value: 30 } }], target_node_id: 'greet_cynical' },
        { conditions: [{ inline: { type: 'global_flag', target_id: 'festival_day', operator: 'has' } }], target_node_id: 'greet_festive' },
        { conditions: [{ inline: { type: 'world_phase', target_id: 'current', operator: 'gt', value: 1 } }], target_node_id: 'greet_world' },
      ],
      choices: [{ text: 'Hi.', prerequisites: null, effects: NO_EFFECTS, next_node_id: null }],
    },
    greet_secret: { id: 'greet_secret', text: 'Mira: You already know, don\'t you?', speaker: 'Mira', routes: null, choices: [{ text: '...', prerequisites: null, effects: NO_EFFECTS, next_node_id: null }] },
    greet_corrupt: { id: 'greet_corrupt', text: 'Mira: Look at you. Changed.', speaker: 'Mira', routes: null, choices: [{ text: '...', prerequisites: null, effects: NO_EFFECTS, next_node_id: null }] },
    greet_cynical: { id: 'greet_cynical', text: 'Mira: Rough day?', speaker: 'Mira', routes: null, choices: [{ text: '...', prerequisites: null, effects: NO_EFFECTS, next_node_id: null }] },
    greet_festive: { id: 'greet_festive', text: 'Mira: Happy festival!', speaker: 'Mira', routes: null, choices: [{ text: '...', prerequisites: null, effects: NO_EFFECTS, next_node_id: null }] },
    greet_world: { id: 'greet_world', text: 'Mira: The world is shifting.', speaker: 'Mira', routes: null, choices: [{ text: '...', prerequisites: null, effects: NO_EFFECTS, next_node_id: null }] },
  },
} as unknown as Dialogue;

function buildState(): GameState {
  return {
    npcs: {
      mira: {
        id: 'mira', name: 'Mira', locations: [],
        affection: { value: 0, high_threshold: 50 }, corruption: { value: 0, high_threshold: 50 },
        traits: {}, daily_counters: {}, flags: {},
      },
    },
    player: {
      stats: { corruption: { value: 0, max: 100, thresholds: [] } },
      skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'plaza', previous_location_id: null,
      world_phase: { current: 1, phases: [] }, flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {}, unlocked_locations: [], unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items: {}, shops: {}, quests: {},
  } as unknown as GameState;
}

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function greet(sm: StateManager, ev: ConditionEvaluator): string {
  const entered = enterNode(dialogue, dialogue.root_node_id, sm.getState(), ev)!;
  return entered.node.id;
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });

  console.log('\n--- Routing breadth: distinct greetings by world state ---');
  {
    const sm = new StateManager(buildState());
    check('default (no state) stays at greeting', greet(sm, ev) === 'greeting');

    sm.getState().global.world_phase.current = 3;
    check('world-phase > 1 routes to greet_world', greet(sm, ev) === 'greet_world');

    sm.getState().global.flags['festival_day'] = true;
    check('festival flag routes to greet_festive', greet(sm, ev) === 'greet_festive');

    sm.getState().player.stats.corruption.value = 30;
    check('corruption >= 30 routes to greet_cynical', greet(sm, ev) === 'greet_cynical');

    sm.getState().player.stats.corruption.value = 60;
    check('corruption >= 60 routes to greet_corrupt', greet(sm, ev) === 'greet_corrupt');

    sm.getState().player.flags['knew_secret'] = true;
    check('knew_secret routes to greet_secret', greet(sm, ev) === 'greet_secret');
  }

  console.log('\n--- Precedence: first matching route wins ---');
  {
    const sm = new StateManager(buildState());
    sm.getState().player.flags['knew_secret'] = true;
    sm.getState().player.stats.corruption.value = 90;
    sm.getState().global.flags['festival_day'] = true;
    sm.getState().global.world_phase.current = 5;
    check('secret wins over all (top precedence)', greet(sm, ev) === 'greet_secret');
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
