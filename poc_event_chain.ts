// ============================================================
// poc_event_chain.ts — Minigame POC #3 (throwaway)
// Validates: event chaining (event A -> choice -> event B -> choice
// -> event C), reusing the real events.ts. No NPCs/locations.
// Drives REAL engine against an in-memory event chain + state.
// Does NOT touch data/ fixtures. Run: npx ts-node poc_event_chain.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { getEventWithAvailableChoices, resolveEventChoice, evaluateActionEventTrigger } from './events';
import { Event, GameState } from './types';

// Three events linked by effects.event_id (+ event_probability).
const events = {
  ev_a: {
    id: 'ev_a',
    text: 'A stranger slides you a note.',
    choices: [
      {
        text: 'Read it.',
        prerequisites: null,
        effects: {
          text: 'The note points to a door.', text_key: null, scene_id: null,
          stat_bumps: null, npc_effects: null, money_delta: null, player_flags: { read_note: true },
          global_emissions: null, item_grants: null, item_consumes: null, quest_triggers: null,
          event_id: 'ev_b', event_probability: 1,
        },
      },
    ],
  },
  ev_b: {
    id: 'ev_b',
    text: 'The door creaks open to a dim room.',
    choices: [
      {
        text: 'Step inside.',
        prerequisites: null,
        effects: {
          text: 'A figure waits within.', text_key: null, scene_id: null,
          stat_bumps: null, npc_effects: null, money_delta: null, player_flags: null,
          global_emissions: null, item_grants: null, item_consumes: null, quest_triggers: null,
          event_id: 'ev_c', event_probability: 1,
        },
      },
    ],
  },
  ev_c: {
    id: 'ev_c',
    text: 'The figure speaks: "You came."',
    choices: [
      {
        text: 'Listen.',
        prerequisites: null,
        effects: {
          text: 'You learn the truth. +$20.', text_key: null, scene_id: null,
          stat_bumps: null, npc_effects: null, money_delta: 20, player_flags: { heard_truth: true },
          global_emissions: null, item_grants: null, item_consumes: null, quest_triggers: null,
          event_id: null, event_probability: null,
        },
      },
    ],
  },
} as unknown as Record<string, Event>;

function buildState(): GameState {
  return {
    npcs: {},
    player: {
      stats: {}, skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'nowhere', previous_location_id: null,
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

// Walk an event chain by always taking choice 0, following effects.event_id.
function walkChain(sm: StateManager, ev: ConditionEvaluator, startId: string): string[] {
  const visited: string[] = [];
  let currentId: string | null = startId;
  let guard = 0;
  while (currentId && guard++ < 20) {
    const withChoices = getEventWithAvailableChoices(events, currentId, sm.getState(), ev);
    if (!withChoices || withChoices.available_choices.length === 0) break;
    visited.push(currentId);
    const result = resolveEventChoice(withChoices.event, 0, sm, ev);
    currentId = result.success ? evaluateActionEventTrigger(withChoices.event.choices[0].effects) : null;
  }
  return visited;
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });

  console.log('\n--- Chain A->B->C (probability 1 forces each hop) ---');
  {
    const sm = new StateManager(buildState());
    const visited = walkChain(sm, ev, 'ev_a');
    check('visited A, B, C in order', JSON.stringify(visited) === JSON.stringify(['ev_a', 'ev_b', 'ev_c']));
    check('read_note flag set at A', sm.getState().player.flags['read_note'] === true);
    check('heard_truth flag set at C', sm.getState().player.flags['heard_truth'] === true);
    check('+$20 applied at C', sm.getState().player.economy.balance === 20);
  }

  console.log('\n--- Probability gate: setting B->C to p=0 breaks the chain at B ---');
  {
    // Mutate the in-memory chain: ev_b choice points to ev_c but p=0.
    const ev_b = events['ev_b'];
    ev_b.choices[0].effects.event_probability = 0;
    const sm = new StateManager(buildState());
    const visited = walkChain(sm, ev, 'ev_a');
    check('chain stops at B (no C)', JSON.stringify(visited) === JSON.stringify(['ev_a', 'ev_b']));
    check('heard_truth NOT set', sm.getState().player.flags['heard_truth'] !== true);
  }

  console.log('\n--- Broken link: B has no event_id -> chain ends at B ---');
  {
    const ev_b = events['ev_b'];
    ev_b.choices[0].effects.event_id = null;
    ev_b.choices[0].effects.event_probability = 1;
    const sm = new StateManager(buildState());
    const visited = walkChain(sm, ev, 'ev_a');
    check('chain ends at B', JSON.stringify(visited) === JSON.stringify(['ev_a', 'ev_b']));
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
