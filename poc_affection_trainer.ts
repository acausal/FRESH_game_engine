// ============================================================
// poc_affection_trainer.ts — Minigame POC #4 (throwaway)
// Validates: repeatable NPC interaction bumps affection/corruption,
// and crossing the axis high_threshold + filling a trait tier across
// the REST cycle auto-advances the NPC's trait tier.
// Drives REAL executeAction + runRestCycle against in-memory state.
// Does NOT touch data/ fixtures. Run: npx ts-node poc_affection_trainer.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { runRestCycle } from './rest';
import { executeAction } from './actions';
import { GameState, NPC, Action } from './types';

// Full NPC definition (passed to runRestCycle for trait checks).
const trainerDef: NPC = {
  id: 'trainer',
  name: 'Trainer',
  description: '',
  locations: [],
  affection: { value: 0, high_threshold: 5 },
  corruption: { value: 0, high_threshold: 50 },
  traits: {
    warmth: {
      unlocked: true,
      unlock_conditions: null,
      current_tier: 0,
      tiers: [
        { value: 0, cap: 3, advance_conditions: null }, // auto-advance
        { value: 0, cap: 3, advance_conditions: null },
      ],
    },
  },
  daily_counters: {},
  flags: {},
  emits: [],
} as unknown as NPC;

function buildState(): GameState {
  return {
    npcs: {
      trainer: {
        id: 'trainer', name: 'Trainer', locations: [],
        affection: { value: 0, high_threshold: 5 },
        corruption: { value: 0, high_threshold: 50 },
        traits: {
          warmth: { unlocked: true, current_tier: 0, tiers: [{ value: 0, cap: 3, advance_conditions: null }, { value: 0, cap: 3, advance_conditions: null }] },
        },
        daily_counters: {}, flags: {},
      },
    },
    player: {
      stats: {}, skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'anywhere', previous_location_id: null,
      world_phase: { current: 1, phases: [] }, flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {}, unlocked_locations: [], unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items: {}, shops: {}, quests: {},
  } as unknown as GameState;
}

// A repeatable "chat" that bumps trainer affection +3 and warmth trait +1.
const chatAction: Action = {
  id: 'chat_trainer',
  name: 'Chat with Trainer',
  description: '',
  action_type: 'npc_interaction',
  context: { type: 'npc', target_id: 'trainer' },
  visibility: { conditions: [] },
  availability: {
    caps: { daily: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' }, lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' } },
    prerequisites: { money: null, items: null, flags: null },
  },
  effects: {
    text: 'You chat.', text_key: null, scene_id: null,
    stat_bumps: null,
    npc_effects: { npc_id: 'trainer', affection: 3, corruption: null, trait_bumps: { trait_id: 'warmth', value: 1 }, flags: null },
    money_delta: null, player_flags: null, global_emissions: null,
    item_grants: null, item_consumes: null, quest_triggers: null,
    event_id: null, event_probability: null,
  },
  assets: { icon: null },
} as unknown as Action;

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });
  const npcs: Record<string, NPC> = { trainer: trainerDef };

  console.log('\n--- Repeatable chat bumps affection + trait ---');
  {
    const sm = new StateManager(buildState());
    // Apply chat 3x: affection clamps at threshold 5, warmth tier value 0->3 (= cap).
    for (let i = 0; i < 3; i++) executeAction(chatAction, sm, ev, undefined);
    check('affection clamps at high_threshold (5)', sm.getState().npcs['trainer'].affection.value === 5);
    check('warmth tier0 value reached cap 3', sm.getState().npcs['trainer'].traits['warmth'].tiers[0].value === 3);
    check('still tier 0 before rest', sm.getState().npcs['trainer'].traits['warmth'].current_tier === 0);

    // Advance the day — REST cycle should auto-advance the trait tier.
    sm.clearRested();
    const rest = runRestCycle(sm, ev, npcs, {});
    check('rest succeeded', rest.success);
    check('warmth advanced to tier 1', sm.getState().npcs['trainer'].traits['warmth'].current_tier === 1);
    check('tier1 value reset to 0', sm.getState().npcs['trainer'].traits['warmth'].tiers[1].value === 0);
    check('affection persisted across rest (clamped 5)', sm.getState().npcs['trainer'].affection.value === 5);
  }

  console.log('\n--- No trait bump, no advancement ---');
  {
    const sm = new StateManager(buildState());
    // One chat: affection 3 (below threshold 5), warmth value 1 (below cap 3).
    executeAction(chatAction, sm, ev, undefined);
    sm.clearRested();
    runRestCycle(sm, ev, npcs, {});
    check('warmth still tier 0', sm.getState().npcs['trainer'].traits['warmth'].current_tier === 0);
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
