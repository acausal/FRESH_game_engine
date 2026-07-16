// ============================================================
// poc_random_encounter.ts — Minigame POC #6 (throwaway)
// Validates: location-triggered random events — probability gate,
// condition gate, one_time cooldown, Tracery flavor expansion, and
// reward application (money/stat). Drives REAL random_events.ts +
// grammar.ts against in-memory state.
// Does NOT touch data/ fixtures. Run: npx ts-node poc_random_encounter.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { evaluateLocationEvents, applyEventRewards } from './random_events';
import { expandText } from './grammar';
import { GameState, RandomEvent } from './types';

function buildState(): GameState {
  return {
    npcs: {},
    player: {
      stats: { luck: { value: 0, max: 100, thresholds: [] } },
      skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'park', previous_location_id: null,
      world_phase: { current: 1, phases: [] }, flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {}, unlocked_locations: [], unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items: {}, shops: {}, quests: {},
  } as unknown as GameState;
}

// Always-fires coin find (Tracery flavor text via grammar key).
const foundCoin: RandomEvent = {
  event_id: 'found_coin', conditions: null, probability: 1, trigger: 'on_visit',
  trigger_action_id: null, cooldown: { type: 'none', last_fired: null },
  content: { text: 'daily_reset_text', rewards: { money: 5, items: null, stat_bumps: null } },
} as unknown as RandomEvent;

// Zero-probability event (must never fire).
const rareGem: RandomEvent = {
  event_id: 'rare_gem', conditions: null, probability: 0, trigger: 'on_visit',
  trigger_action_id: null, cooldown: { type: 'none', last_fired: null },
  content: { text: 'daily_reset_text', rewards: { money: 100, items: null, stat_bumps: null } },
} as unknown as RandomEvent;

// Condition-gated event (fires only when player flag set).
const flaggedEvent: RandomEvent = {
  event_id: 'flagged_event', conditions: [{ inline: { type: 'player_flag', target_id: 'met_player', operator: 'has' } }],
  probability: 1, trigger: 'on_visit', trigger_action_id: null,
  cooldown: { type: 'none', last_fired: null },
  content: { text: 'daily_reset_text', rewards: { money: 0, items: null, stat_bumps: { luck: 3 } } },
} as unknown as RandomEvent;

// One-time event (fires once, then cooldown blocks it).
const oneTimeEvent: RandomEvent = {
  event_id: 'one_time_event', conditions: null, probability: 1, trigger: 'on_visit',
  trigger_action_id: null, cooldown: { type: 'one_time', last_fired: null },
  content: { text: 'daily_reset_text', rewards: { money: 10, items: null, stat_bumps: null } },
} as unknown as RandomEvent;

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });

  console.log('\n--- Always-fires event: fires + grants + Tracery flavor ---');
  {
    const sm = new StateManager(buildState());
    const result = evaluateLocationEvents([foundCoin], null, sm.getState(), ev);
    check('fired', result.fired);
    check('resolution delivered', !!result.resolution);
    const before = sm.getState().player.economy.balance;
    if (result.resolution) applyEventRewards(result.resolution, sm);
    check('+$5 applied', sm.getState().player.economy.balance === before + 5);
    // Tracery: the content text is a grammar key that expands to real prose.
    const expanded = expandText(result.resolution!.text);
    check('flavor text expanded (non-key, non-empty)', expanded.length > 0 && !expanded.startsWith('((') && !expanded.startsWith('#'));
  }

  console.log('\n--- Probability gate: p=0 never fires ---');
  {
    const sm = new StateManager(buildState());
    const result = evaluateLocationEvents([rareGem], null, sm.getState(), ev);
    check('did NOT fire', !result.fired);
  }

  console.log('\n--- Condition gate: only fires when flag set ---');
  {
    const sm = new StateManager(buildState());
    check('blocked before flag', !evaluateLocationEvents([flaggedEvent], null, sm.getState(), ev).fired);
    sm.getState().player.flags['met_player'] = true;
    const r = evaluateLocationEvents([flaggedEvent], null, sm.getState(), ev);
    check('fires after flag set', r.fired);
    if (r.resolution) applyEventRewards(r.resolution, sm);
    check('luck +3 applied', sm.getState().player.stats['luck'].value === 3);
  }

  console.log('\n--- Cooldown: one_time fires once then blocks ---');
  {
    const sm = new StateManager(buildState());
    check('first eval fires', evaluateLocationEvents([oneTimeEvent], null, sm.getState(), ev).fired);
    // Simulate the cooldown being marked (console does this after firing).
    oneTimeEvent.cooldown.last_fired = sm.getState().global.day.count;
    check('second eval blocked', !evaluateLocationEvents([oneTimeEvent], null, sm.getState(), ev).fired);
  }

  console.log('\n--- Tracery: expansion is randomized, missing key falls back ---');
  {
    const a = expandText('daily_reset_text');
    const b = expandText('daily_reset_text');
    check('two expansions are plausible prose', a.length > 0 && b.length > 0);
    const missing = expandText('no_such_rule_xyz');
    check('missing key returns ((key)) fallback', missing === '((no_such_rule_xyz))');
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
