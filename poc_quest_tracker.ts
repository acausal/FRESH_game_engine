// ============================================================
// poc_quest_tracker.ts — Minigame POC #7 (throwaway)
// Validates: multi-stage quest lifecycle — auto-start on condition,
// stage-to-stage advancement via completion_conditions across the
// REST cycle, and final completion. Drives REAL quest.ts.
// Does NOT touch data/ fixtures. Run: npx ts-node poc_quest_tracker.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { QuestManager } from './quest';
import { GameState, Quest } from './types';

const trainQuest: Quest = {
  id: 'train_quest',
  name: 'Training Regimen',
  description: 'A trainer offers to school you.',
  visibility: { conditions: null },
  auto_start: { conditions: [{ inline: { type: 'player_flag', target_id: 'met_trainer', operator: 'has' } }] },
  stages: [
    {
      id: 'meet', description: 'Meet the trainer.',
      completion_conditions: [{ inline: { type: 'player_flag', target_id: 'met_trainer', operator: 'has' } }],
      on_complete: null, on_complete_event_id: null, fail_conditions: null,
    },
    {
      id: 'practice', description: 'Train until skilled.',
      completion_conditions: [{ inline: { type: 'player_stat', target_id: 'training', operator: 'gte', value: 2 } }],
      on_complete: null, on_complete_event_id: null, fail_conditions: null,
    },
    {
      id: 'finish', description: 'Graduate.',
      completion_conditions: null,  // final stage auto-completes
      on_complete: null, on_complete_event_id: null, fail_conditions: null,
    },
  ],
} as unknown as Quest;

function buildState(): GameState {
  return {
    npcs: {},
    player: {
      stats: { training: { value: 0, max: 10, thresholds: [] } },
      skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance: 0, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'gym', previous_location_id: null,
      world_phase: { current: 1, phases: [] }, flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      // Quest registered as not-started (the loader would do this from data).
      quest_states: {
        train_quest: {
          quest_id: 'train_quest', current_stage_index: 0,
          started_at: { day: 0, phase: 0 }, stage_started_at: { day: 0, phase: 0 },
          completed: false, failed: false,
        },
      },
      unlocked_locations: [], unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items: {}, shops: {}, quests: { train_quest: trainQuest },
  } as unknown as GameState;
}

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function rest(sm: StateManager, ev: ConditionEvaluator) {
  // Mirror the console's day-start wake-step + the REST quest progression.
  sm.clearRested();
  const qm = new QuestManager(sm.getState().quests);
  return qm.evaluateDuringRestCycle(sm, ev);
}

function stageOf(sm: StateManager): number {
  return sm.getState().global.quest_states['train_quest'].current_stage_index;
}
function isComplete(sm: StateManager): boolean {
  return sm.getState().global.quest_states['train_quest'].completed;
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });

  console.log('\n--- Quest auto-starts, then walks stages across REST ---');
  {
    const sm = new StateManager(buildState());
    // Precondition for auto-start met.
    sm.getState().player.flags['met_trainer'] = true;

    // REST 1: auto-start (stage 0) + stage0 completes (met_trainer) -> stage 1 active.
    let r = rest(sm, ev);
    check('auto-started (1 initiation)', r.initiations.length === 1);
    check('advanced to stage 1', stageOf(sm) === 1);
    check('not complete yet', !isComplete(sm));

    // Train to satisfy stage 1 condition.
    sm.getState().player.stats['training'].value = 2;

    // REST 2: stage1 completes -> stage 2 (final) active.
    r = rest(sm, ev);
    check('stage 1 completed', r.completions.length >= 1);
    check('reached final stage (index 2)', stageOf(sm) === 2);
    check('not yet complete (final stage resolves next REST)', !isComplete(sm));

    // REST 3: final stage auto-completes -> quest done.
    r = rest(sm, ev);
    check('quest completed', isComplete(sm));
  }

  console.log('\n--- No auto-start before flag set ---');
  {
    const sm = new StateManager(buildState());
    const r = rest(sm, ev);
    check('no initiation', r.initiations.length === 0);
    check('still stage 0 / not started', stageOf(sm) === 0 && !isComplete(sm));
  }

  console.log('\n--- Partial progress holds across REST ---');
  {
    const sm = new StateManager(buildState());
    sm.getState().player.flags['met_trainer'] = true;
    rest(sm, ev);                       // -> stage 1
    check('at stage 1', stageOf(sm) === 1);
    // REST again without training: stage 1 not met, must stay at stage 1.
    rest(sm, ev);
    check('stays at stage 1 (no regression)', stageOf(sm) === 1 && !isComplete(sm));
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
