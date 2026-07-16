// ============================================================
// poc_daily_grind.ts — Minigame POC #1 (throwaway)
// Validates: action lifecycle + daily caps + REST cycle
//            (counter resets, day advance, weekly income).
// Drives the REAL engine (executeAction + runRestCycle) against a
// purpose-built in-memory state. Does NOT touch data/ fixtures.
// Run: npx ts-node poc_daily_grind.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { executeAction } from './actions';
import { runRestCycle } from './rest';
import { GameState, Action } from './types';

// ── Minimal prototype state ──────────────────────────────────
// Small enough to reason about; exercises economy + caps + rest.

function buildState(): GameState {
  return {
    npcs: {},
    player: {
      stats: {},
      skills: {},
      inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 50, weekly_income: 30, income_upgrade_cost: 150, income_max: 150 },
      daily_counters: {},
      flags: {},
    },
    global: {
      current_location_id: 'home',
      previous_location_id: null,
      world_phase: { current: 1, phases: [] },
      flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {},
      unlocked_locations: ['home', 'street'],
      unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items: {},
    shops: {},
    quests: {},
  } as unknown as GameState;
}

// Two work actions with different daily caps to show the reset.
function buildActions(): Action[] {
  const make = (id: string, pay: number, dailyMax: number): Action => ({
    id, name: id, description: '', action_type: 'location_action',
    context: { type: 'location', target_id: 'home' },
    visibility: { conditions: null },
    availability: {
      caps: { daily: { enabled: true, max: dailyMax, current: 0, when_exhausted: 'grey_out' },
              lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' } },
      prerequisites: { money: null, items: null, flags: null },
    },
    effects: {
      text: `Work done (+$${pay}).`, text_key: null, scene_id: null, stat_bumps: null,
      npc_effects: null, money_delta: pay, player_flags: null, global_emissions: null,
      item_grants: null, item_consumes: null, quest_triggers: null,
      event_id: null, event_probability: null,
    },
    assets: { icon: null },
  }) as unknown as Action;

  return [make('shift_a', 10, 2), make('shift_b', 25, 1)];
}

// ── POC driver ───────────────────────────────────────────────

function run() {
  const sm = new StateManager(buildState());
  const ev = new ConditionEvaluator({ conditions: {} });
  const actions = buildActions();

  console.log('=== Daily Grind POC ===');
  console.log(`Start: Day ${sm.getState().global.day.count}, $${sm.getState().player.economy.balance}\n`);

  // Play 10 days. Each day: work every available shift until caps hit, then rest.
  for (let day = 1; day <= 10; day++) {
    // Work loop: repeatedly take any still-available work action until none remain.
    let dayEarned = 0;
    let guard = 0;
    while (guard++ < 20) {
      const next = actions.find(a => {
        const cap = a.availability.caps.daily;
        return !cap.enabled || cap.current < (cap.max ?? Infinity);
      });
      if (!next) break;
      const status = executeAction(next, sm, ev);
      if (!status.success) break;
      dayEarned++;
    }

    // Advance the day. The console normally clears `rested` at day-start
    // (first waking action) and resets action counters itself; replicate both
    // here. Action caps live OUTSIDE GameState (the engine's documented
    // gotcha), so the driver must reset them just like the console does.
    sm.clearRested();
    for (const action of actions) {
      action.availability.caps.daily.current = 0;
      action.availability.caps.lifetime.current = 0;
    }
    const rest = runRestCycle(sm, ev, {}, {});

    const st = sm.getState();
    console.log(
      `Day ${day}: ${dayEarned} shifts worked -> $${st.player.economy.balance}` +
      (rest.notifications.some(n => n.includes('Weekly')) ? '  [+WEEKLY INCOME]' : '')
    );
  }

  const fin = sm.getState();
  console.log(`\nEnd: Day ${fin.global.day.count}, $${fin.player.economy.balance}`);
  console.log(`Expected balance: 50 + (10d * (10*2 + 25)) + 1 weekly(30) = 50 + 450 + 30 = 530`);
  console.log(`Caps reset each day? ${actions[0].availability.caps.daily.current === 0 ? 'YES' : 'NO (BUG)'}`);
}

run();
