// ============================================================
// poc_branching_mystery.ts — Minigame POC #8 (throwaway, capstone)
// Vertical slice integrating dialogue + events + items + location
// unlock through the REAL engine:
//   talk -> branching dialogue (grants key, flags, triggers event)
//       -> event choice (emits global unlock flag)
//       -> REST cycle unlocks the hidden location
// Does NOT touch data/ fixtures. Run: npx ts-node poc_branching_mystery.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { enterNode, resolveDialogueChoice } from './dialogue';
import { loadEvent, getEventWithAvailableChoices, resolveEventChoice, evaluateActionEventTrigger } from './events';
import { runRestCycle } from './rest';
import { Dialogue, GameState, Event, NPC, Item } from './types';

const FLAG_HAS = (id: string) => ({ inline: { type: 'player_flag', target_id: id, operator: 'has', value: true } });

const NO_EFFECTS = {
  text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
  money_delta: null, player_flags: null, global_emissions: null,
  item_grants: null, item_consumes: null, quest_triggers: null,
  event_id: null, event_probability: null,
};

const dialogue = {
  id: 'curator_poc', npc_id: 'curator', root_node_id: 'greet',
  nodes: {
    greet: {
      id: 'greet', text: 'The curator eyes you.', speaker: 'Curator',
      routes: [{ conditions: [FLAG_HAS('knows_rumor')], target_node_id: 'greet_knowing' }],
      choices: [
        {
          text: 'Ask about the vault.', prerequisites: null,
          effects: {
            text: 'The curator slips you a key.', text_key: null, scene_id: null, stat_bumps: null,
            npc_effects: null, money_delta: null, player_flags: { met_curator: true },
            global_emissions: null, item_grants: [{ item_id: 'vault_key', quantity: 1 }],
            item_consumes: null, quest_triggers: null, event_id: 'vault_event', event_probability: 1,
          },
          next_node_id: null,
        },
        { text: 'Leave.', prerequisites: null, effects: NO_EFFECTS, next_node_id: null },
      ],
    },
    greet_knowing: {
      id: 'greet_knowing', text: 'The curator: you heard the rumor.', speaker: 'Curator', routes: null,
      choices: [
        {
          text: 'Ask about the vault.', prerequisites: null,
          effects: {
            text: 'The curator slips you a key.', text_key: null, scene_id: null, stat_bumps: null,
            npc_effects: null, money_delta: null, player_flags: { met_curator: true },
            global_emissions: null, item_grants: [{ item_id: 'vault_key', quantity: 1 }],
            item_consumes: null, quest_triggers: null, event_id: 'vault_event', event_probability: 1,
          },
          next_node_id: null,
        },
      ],
    },
  },
} as unknown as Dialogue;

const vaultEvent = {
  id: 'vault_event', text: 'A hidden passage responds to the key.',
  choices: [
    {
      text: 'Step through.', prerequisites: null,
      effects: {
        text: 'The vault door groans open.', text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
        money_delta: null, player_flags: null, global_emissions: [{ flag: 'vault_unlocked', value: true }],
        item_grants: null, item_consumes: null, quest_triggers: null, event_id: null, event_probability: null,
      },
    },
  ],
} as unknown as Event;

const vaultLocation: any = {
  id: 'vault', name: 'Hidden Vault',
  unlock: { unlocked: false, conditions: [{ inline: { type: 'global_flag', target_id: 'vault_unlocked', operator: 'has' } }] },
};

const vaultKeyItem = {
  id: 'vault_key', item_type: 'key_item', name: 'Vault Key', description: '',
  base_value: 0, consumable: null, key_item: null, gift: null,
} as unknown as Item;

const curatorNpc = {
  id: 'curator', name: 'Curator', description: '', locations: [],
  affection: { value: 0, high_threshold: 50 }, corruption: { value: 0, high_threshold: 50 },
  traits: {}, daily_counters: {}, flags: {}, emits: [],
} as unknown as NPC;

function buildState(): GameState {
  return {
    npcs: { curator: curatorNpc },
    player: {
      stats: {}, skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'museum', previous_location_id: null,
      world_phase: { current: 1, phases: [] }, flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {}, unlocked_locations: ['museum'], unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items: { vault_key: vaultKeyItem }, shops: {}, quests: {},
  } as unknown as GameState;
}

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });
  const events: Record<string, Event> = { vault_event: vaultEvent };
  const npcs: Record<string, NPC> = { curator: curatorNpc };

  console.log('\n--- Full slice: talk -> dialogue -> event -> unlock ---');
  {
    const sm = new StateManager(buildState());
    const entered = enterNode(dialogue, dialogue.root_node_id, sm.getState(), ev)!;
    check('entered default greeting', entered.node.id === 'greet');

    const dlgResult = resolveDialogueChoice(entered.node, 0, sm, ev);
    check('dialogue choice succeeded', dlgResult.success);
    check('vault_key granted to key_items', sm.getState().player.inventory.key_items['vault_key'] === true);
    check('met_curator flag set', sm.getState().player.flags['met_curator'] === true);

    const nextEventId = evaluateActionEventTrigger(entered.node.choices[0].effects);
    check('event chain fired (vault_event)', nextEventId === 'vault_event');
    const evWithChoices = getEventWithAvailableChoices(events, nextEventId!, sm.getState(), ev)!;
    const evResult = resolveEventChoice(evWithChoices.event, 0, sm, ev);
    check('event choice succeeded', evResult.success);
    check('global flag vault_unlocked emitted', sm.getState().global.flags['vault_unlocked'] === true);

    check('vault locked before rest', !sm.getState().global.unlocked_locations.includes('vault'));

    sm.clearRested();
    const rest = runRestCycle(sm, ev, npcs, { vault: vaultLocation });
    check('rest succeeded', rest.success);
    check('vault UNLOCKED after rest', sm.getState().global.unlocked_locations.includes('vault'));
  }

  console.log('\n--- Branching: knows_rumor flag takes the knowing route ---');
  {
    const sm = new StateManager(buildState());
    sm.getState().player.flags['knows_rumor'] = true;
    const entered = enterNode(dialogue, dialogue.root_node_id, sm.getState(), ev)!;
    check('routed to greet_knowing', entered.node.id === 'greet_knowing');
  }

  console.log('\n--- Dead end: Leave grants nothing, no unlock ---');
  {
    const sm = new StateManager(buildState());
    const entered = enterNode(dialogue, dialogue.root_node_id, sm.getState(), ev)!;
    resolveDialogueChoice(entered.node, 1, sm, ev);
    check('no key granted', !('vault_key' in sm.getState().player.inventory.key_items));
    check('vault still locked', !sm.getState().global.unlocked_locations.includes('vault'));
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
