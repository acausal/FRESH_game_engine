// ============================================================
// poc_conversation_tree.ts — Minigame POC #2 (throwaway)
// Validates: dialogue graph engine — conditional auto-routing,
// response prerequisite filtering, and node-to-node advancement.
// Drives the REAL dialogue.ts against an in-memory dialogue + state.
// Does NOT touch data/ fixtures. Run: npx ts-node poc_conversation_tree.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { enterNode, resolveDialogueChoice } from './dialogue';
import { Dialogue, GameState } from './types';

const dialogue = {
  id: 'barkeep_poc',
  npc_id: 'barkeep',
  root_node_id: 'greeting',
  nodes: {
    greeting: {
      id: 'greeting',
      text: 'The barkeep wipes a glass and eyes you.',
      speaker: 'Barkeep',
      routes: [
        {
          conditions: [{ inline: { type: 'player_stat', target_id: 'corruption', operator: 'gte', value: 50 } }],
          target_node_id: 'dark_greeting',
        },
      ],
      choices: [
        {
          text: 'Any work going?',
          prerequisites: null,
          effects: {
            text: 'The barkeep nods toward the storeroom.', text_key: null, scene_id: null,
            stat_bumps: null, npc_effects: null, money_delta: null, player_flags: { asked_for_work: true },
            global_emissions: null, item_grants: null, item_consumes: null, quest_triggers: null,
            event_id: null, event_probability: null,
          },
          next_node_id: 'work_offer',
        },
        {
          text: 'Just a drink.',
          prerequisites: null,
          effects: {
            text: 'The barkeep pours.', text_key: null, scene_id: null,
            stat_bumps: null, npc_effects: null, money_delta: null, player_flags: null,
            global_emissions: null, item_grants: null, item_consumes: null, quest_triggers: null,
            event_id: null, event_probability: null,
          },
          next_node_id: null,
        },
      ],
    },
    dark_greeting: {
      id: 'dark_greeting',
      text: 'The barkeep smirks. "Heard about you. What do you want?"',
      speaker: 'Barkeep',
      routes: null,
      choices: [
        {
          text: 'A job, maybe?',
          prerequisites: null,
          effects: {
            text: 'A knowing look.', text_key: null, scene_id: null,
            stat_bumps: { stat_id: 'corruption', value: 5 }, npc_effects: null, money_delta: null,
            player_flags: { asked_for_work: true }, global_emissions: null, item_grants: null,
            item_consumes: null, quest_triggers: null, event_id: null, event_probability: null,
          },
          next_node_id: 'work_offer',
        },
      ],
    },
    work_offer: {
      id: 'work_offer',
      text: 'Storeroom needs clearing. Interested?',
      speaker: 'Barkeep',
      routes: null,
      choices: [
        {
          text: 'Done.',
          prerequisites: [{ inline: { type: 'player_flag', target_id: 'asked_for_work', operator: 'has' } }],
          effects: {
            text: 'You shake on it. +$15.', text_key: null, scene_id: null,
            stat_bumps: null, npc_effects: { npc_id: 'barkeep', affection: 3, corruption: null, trait_bumps: null, flags: null },
            money_delta: 15, player_flags: null, global_emissions: null, item_grants: null,
            item_consumes: null, quest_triggers: null, event_id: null, event_probability: null,
          },
          next_node_id: null,
        },
        {
          text: 'Not today.',
          prerequisites: null,
          effects: {
            text: 'The barkeep shrugs.', text_key: null, scene_id: null,
            stat_bumps: null, npc_effects: null, money_delta: null, player_flags: null,
            global_emissions: null, item_grants: null, item_consumes: null, quest_triggers: null,
            event_id: null, event_probability: null,
          },
          next_node_id: null,
        },
      ],
    },
  },
} as unknown as Dialogue;

function buildState(): GameState {
  return {
    npcs: {
      barkeep: {
        id: 'barkeep', name: 'Barkeep', locations: [], affection: { value: 0, high_threshold: 50 },
        corruption: { value: 0, high_threshold: 50 }, traits: {}, daily_counters: {}, flags: {},
      },
    },
    player: {
      stats: { corruption: { value: 0, max: 100, thresholds: [] } },
      skills: {},
      inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {},
      flags: {},
    },
    global: {
      current_location_id: 'bar', previous_location_id: null,
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

function choose(sm: StateManager, ev: ConditionEvaluator, nodeId: string | null, choiceIdx: number) {
  const entered = enterNode(dialogue, nodeId ?? dialogue.root_node_id, sm.getState(), ev)!;
  const result = resolveDialogueChoice(entered.node, choiceIdx, sm, ev);
  return { nodeText: entered.node.text, result };
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });

  console.log('\n--- Path A: clean greeting -> ask work -> accept ---');
  {
    const sm = new StateManager(buildState());
    const a = choose(sm, ev, null, 0);
    check('A: entered work_offer node', a.result.next_node_id === 'work_offer');
    const b = choose(sm, ev, a.result.next_node_id, 0);
    check('A: gated "Done" available after asking', b.result.success);
    check('A: +$15 applied', sm.getState().player.economy.balance === 15);
    check('A: barkeep affection +3', sm.getState().npcs['barkeep'].affection.value === 3);
    check('A: conversation ends (next=null)', b.result.next_node_id === null);
  }

  console.log('\n--- Path B: clean greeting -> "just a drink" ends ---');
  {
    const sm = new StateManager(buildState());
    const a = choose(sm, ev, null, 1);
    check('B: conversation ends immediately', a.result.next_node_id === null);
  }

  console.log('\n--- Path C: corruption >= 50 auto-routes to dark_greeting ---');
  {
    const sm = new StateManager(buildState());
    sm.getState().player.stats.corruption.value = 50;
    const entered = enterNode(dialogue, dialogue.root_node_id, sm.getState(), ev)!;
    check('C: routed to dark_greeting', entered.node.id === 'dark_greeting');
    const a = choose(sm, ev, 'dark_greeting', 0);
    check('C: chain into work_offer', a.result.next_node_id === 'work_offer');
    check('C: corruption bumped +5', sm.getState().player.stats.corruption.value === 55);
    check('C: asked_for_work flag set', sm.getState().player.flags['asked_for_work'] === true);
  }

  console.log('\n--- Path D: gating — "Done" hidden until flag set ---');
  {
    const sm = new StateManager(buildState());
    const entered = enterNode(dialogue, 'work_offer', sm.getState(), ev)!;
    check('D: only ungated response shown (1 of 2)', entered.available_responses.length === 1);
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
