// ============================================================
// rest.ts — Rest / sleep cycle
// The engine's primary maintenance window.
// Runs once per day when the player takes the rest action.
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import { expandTextWithContext } from './grammar';
import { QuestManager } from './quest';
import { GameState, NPC, WorldPhaseDefinition } from './types';

// ── Notification Helpers ──────────────────────────────────
// Notifications now use Tracery grammar via expandTextWithContext()
// See grammar/notifications.json for text variations

// ── Rest Result ───────────────────────────────────────────────

export interface RestResult {
  success: boolean;
  reason?: string;           // why rest failed (already rested, wrong location, etc.)
  notifications: string[];   // morning summary delivered on wake
}

// ── Rest Cycle ────────────────────────────────────────────────

export function runRestCycle(
  stateManager: StateManager,
  evaluator: ConditionEvaluator,
  npcs: Record<string, NPC>,    // full NPC objects for emit/condition checking
  locations?: Record<string, any>  // location objects with unlock conditions
): RestResult {
  const state = stateManager.getState();

  // Guard: can't rest twice in one day
  if (state.global.day.rested) {
    return {
      success: false,
      reason: "You've already rested today.",
      notifications: [],
    };
  }

  stateManager.setRested();

  // ── Step 1: Phase Advancement Check ──────────────────────────
  // Must run before NPC breakthrough checks so phase flags are
  // written before NPC conditions are evaluated.

  const phases = state.global.world_phase.phases;
  const currentPhase = state.global.world_phase.current;
  const nextPhase = phases.find(p => p.phase_number === currentPhase + 1);

  if (nextPhase) {
    const conditionsMet = nextPhase.advancement_conditions.every(ref =>
      evaluator.evaluate(ref, state)
    );

    if (conditionsMet) {
      stateManager.advanceWorldPhase();

      // Write phase flags to global state
      stateManager.setGlobalFlags(nextPhase.on_advance.global_flags);

      // Queue phase notification
      stateManager.queueNotification(
        expandTextWithContext('phase_advance', {
          phase_name: nextPhase.name,
          phase_num: nextPhase.phase_number.toString()
        })
      );

      // Process phase unlocks
      for (const unlockId of nextPhase.on_advance.unlocks) {
        // Unlocks are location_ids, shop_ids, or quest_ids
        // We check global unlocked arrays to determine which type
        // Content-level routing happens here
        if (!state.global.unlocked_locations.includes(unlockId) &&
            !state.global.unlocked_shops.includes(unlockId)) {
          // Try as location first, then shop
          // Quest unlocks just write a flag — quest availability
          // is determined by condition evaluation at the quest level
          stateManager.unlockLocation(unlockId);
        }
      }
    }
  }

  // ── Step 2: Location Unlock Checks ───────────────────────────
  // Evaluate any location unlock conditions and unlock locations
  // whose conditions are now met.

  if (locations) {
    const stateForLocations = stateManager.getState();
    for (const [locationId, location] of Object.entries(locations)) {
      // Skip if already unlocked
      if (stateForLocations.global.unlocked_locations.includes(locationId)) {
        continue;
      }

      // Check if location has unlock conditions
      if (location.unlock && location.unlock.conditions && location.unlock.conditions.length > 0) {
        const unlockedByConditions = location.unlock.conditions.every((ref: any) =>
          evaluator.evaluate(ref, stateForLocations)
        );

        if (unlockedByConditions) {
          stateManager.unlockLocation(locationId);
          stateManager.queueNotification(`${location.name} is now accessible.`);
        }
      }
    }
  }

  // ── Step 3: NPC Breakthrough Checks ──────────────────────────
  // Re-read state after phase advancement so new flags are visible.

  const stateAfterPhase = stateManager.getState();

  const breakthroughNPCs: string[] = [];
  const blockedNPCs: string[] = [];

  for (const npcId of stateManager.getNPCIds()) {
    const npcState = stateAfterPhase.npcs[npcId];
    const fullNPC = npcs[npcId];
    if (!npcState || !fullNPC) continue;

    // Check axes (affection, corruption)
    for (const axis of ['affection', 'corruption'] as const) {
      const axisData = npcState[axis];
      if (axisData.value < axisData.high_threshold) continue;

      // Cap reached — check advance conditions
      // For primary axes we use the NPC's trait system for tier tracking
      // Axis advancement is handled via the emits block on the full NPC
      // Process emits for this NPC
      for (const emit of fullNPC.emits) {
        const emitMet = evaluator.evaluate(emit.condition, stateAfterPhase);
        if (emitMet) {
          stateManager.setGlobalFlag(emit.global_flag, emit.value);
        }
      }
    }

    // Check traits
    for (const [traitId, traitState] of Object.entries(npcState.traits)) {
      if (!traitState.unlocked) continue;

      const currentTierIndex = traitState.current_tier;
      const currentTierData = traitState.tiers[currentTierIndex];
      if (!currentTierData) continue;
      if (currentTierData.value < currentTierData.cap) continue;

      // Tier cap reached — check advance conditions
      const fullTrait = fullNPC.traits[traitId];
      if (!fullTrait) continue;

      const nextTierData = fullTrait.tiers[currentTierIndex + 1];
      if (!nextTierData) continue; // already at max tier

      const advanceConditions = nextTierData.advance_conditions;

      if (advanceConditions === null) {
        // Auto-advance
        stateManager.advanceNPCTrait(npcId, traitId);
        breakthroughNPCs.push(fullNPC.name);
        stateManager.queueNotification(
          expandTextWithContext('npc_breakthrough', {
            npc_names: fullNPC.name,
            trait: traitId,
            tier: (currentTierIndex + 2).toString()
          })
        );
      } else {
        // Check conditions
        const canAdvance = evaluator.evaluateAll(advanceConditions, stateAfterPhase);
        if (canAdvance) {
          stateManager.advanceNPCTrait(npcId, traitId);
          breakthroughNPCs.push(fullNPC.name);
          stateManager.queueNotification(
            expandTextWithContext('npc_breakthrough', {
              npc_names: fullNPC.name,
              trait: traitId,
              tier: (currentTierIndex + 2).toString()
            })
          );
        } else {
          // Blocked — conditions not yet met
          if (!blockedNPCs.includes(fullNPC.name)) {
            blockedNPCs.push(fullNPC.name);
          }
        }
      }
    }
  }

  // Queue a single grouped blocked notification if any NPCs are blocked
  if (blockedNPCs.length > 0) {
    stateManager.queueNotification(
      expandTextWithContext('npc_blocked', {
        blocked_npcs: blockedNPCs.join(', ')
      })
    );
  }

  // ── Step 4: Quest Progression Checks ───────────────────────
  // Overnight quest evaluation — checks auto-start and stage
  // completion for all quests.

  const questManager = new QuestManager(stateAfterPhase.quests);
  const questResult = questManager.evaluateDuringRestCycle(stateManager, evaluator);

  for (const init of questResult.initiations) {
    if (init.notification) {
      stateManager.queueNotification(init.notification);
    }
  }
  for (const completion of questResult.completions) {
    for (const notif of completion.notifications) {
      stateManager.queueNotification(notif);
    }
  }
  for (const fail of questResult.failures) {
    stateManager.queueNotification(fail.notification);
  }

  // ── Step 5: Daily Counter Resets ─────────────────────────────

  stateManager.resetAllDailyCounters();

  // ── Step 6: Day Advancement ───────────────────────────────────

  stateManager.advanceDay();
  // Note: do NOT clearRested() here — the rested flag must persist so the
  // guard at the top of runRestCycle blocks a second rest on the same day.
  // A new day's rest is re-enabled when the player takes their first waking
  // action (console clears rested on day start), not automatically here.

  // Pay weekly income every 7 days
  if (stateManager.getState().global.day.count % 7 === 0) {
    stateManager.payWeeklyIncome();
    stateManager.queueNotification('Weekly income received.');
  }

  // ── Step 7: Assemble Morning Summary ─────────────────────────

  stateManager.queueNotification(expandTextWithContext('daily_reset', {}));

  const notifications = stateManager.flushNotifications();

  return {
    success: true,
    notifications,
  };
}
