// ============================================================
// random_events.ts — Random event resolver
// Evaluates location random_events with condition checking,
// probability rolls, and cooldown tracking.
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import { GameState, RandomEvent, RandomEventCooldown, RandomEventCooldownType } from './types';

// ── Cooldown Helpers ────────────────────────────────────────

/**
 * Check if a random event's cooldown allows it to fire.
 * Returns true if the event is ready to fire.
 */
function checkCooldown(cooldown: RandomEventCooldown, currentDay: number): boolean {
  switch (cooldown.type) {
    case 'none':
      // Always fires (no cooldown)
      return true;

    case 'one_time':
      // Only fires if never fired before
      return cooldown.last_fired === null;

    case 'per_day':
      // Can fire once per day; if last_fired is a different day, it's ready
      return cooldown.last_fired !== currentDay;

    case 'per_phase':
      // Can fire once per phase; if last_fired is a different day, treat as available
      // (Phase changes happen at rest, so this is a reasonable approximation)
      return cooldown.last_fired !== currentDay;

    default:
      return true;
  }
}

// ── Random Event Evaluation ──────────────────────────────────

export interface RandomEventResolution {
  event_id: string;
  text: string;
  rewards: {
    money: number | null;
    items: string[] | null;
    stat_bumps: Record<string, number> | null;
  };
}

export interface RandomEventResult {
  fired: boolean;
  resolution?: RandomEventResolution;
  reason?: string; // why it didn't fire (for debugging)
}

/**
 * Evaluate a single random event against current state.
 * Returns whether it fired and the resolution if so.
 */
export function evaluateRandomEvent(
  event: RandomEvent,
  state: GameState,
  evaluator: ConditionEvaluator
): RandomEventResult {
  const currentDay = state.global.day.count;

  // Check cooldown
  if (!checkCooldown(event.cooldown, currentDay)) {
    return { fired: false, reason: 'cooldown' };
  }

  // Check conditions (if any)
  if (event.conditions && event.conditions.length > 0) {
    const conditionsMet = evaluator.evaluateAll(event.conditions, state);
    if (!conditionsMet) {
      return { fired: false, reason: 'conditions_not_met' };
    }
  }

  // Probability roll
  const roll = Math.random();
  if (roll >= event.probability) {
    return { fired: false, reason: 'probability_roll_failed' };
  }

  // Event fires!
  return {
    fired: true,
    resolution: {
      event_id: event.event_id,
      text: event.content.text,
      rewards: event.content.rewards,
    },
  };
}

// ── Location Random Event Resolution ───────────────────────

export interface LocationEventResult {
  fired: boolean;
  resolution?: RandomEventResolution;
  triggered_event_id?: string | null; // For event_triggers (simple)
}

/**
 * Evaluate all random events for a location visit.
 * Checks both random_events (with conditions/cooldowns) and
 * event_triggers (simple probability-only).
 *
 * Returns the first event that fires (first-match-wins), or null.
 */
export function evaluateLocationEvents(
  randomEvents: RandomEvent[],
  eventTriggers: import('./types').LocationEventTrigger[] | null,
  state: GameState,
  evaluator: ConditionEvaluator
): LocationEventResult {
  // First, check random_events (full system with conditions/cooldowns)
  for (const event of randomEvents) {
    // Only evaluate events that trigger on visit
    if (event.trigger !== 'on_visit') continue;

    const result = evaluateRandomEvent(event, state, evaluator);
    if (result.fired && result.resolution) {
      return {
        fired: true,
        resolution: result.resolution,
      };
    }
  }

  // Fallback: check simple event_triggers (probability only, no cooldown)
  if (eventTriggers && eventTriggers.length > 0) {
    for (const trigger of eventTriggers) {
      const probability = trigger.probability || 1.0;
      if (Math.random() < probability) {
        return {
          fired: true,
          triggered_event_id: trigger.event_id,
        };
      }
    }
  }

  return { fired: false };
}

// ── Action Random Event Resolution ────────────────────────

export interface ActionEventResult {
  fired: boolean;
  resolution?: RandomEventResolution;
}

/**
 * Evaluate random events that trigger on a specific action.
 * Checks events with trigger: 'on_action' and matching trigger_action_id.
 *
 * Returns the first event that fires (first-match-wins), or null.
 */
export function evaluateActionEvents(
  randomEvents: RandomEvent[],
  action_id: string,
  state: GameState,
  evaluator: ConditionEvaluator
): ActionEventResult {
  for (const event of randomEvents) {
    // Only evaluate events that trigger on actions
    if (event.trigger !== 'on_action') continue;

    // Check if this event matches the action that was executed
    if (event.trigger_action_id !== action_id) continue;

    const result = evaluateRandomEvent(event, state, evaluator);
    if (result.fired && result.resolution) {
      return {
        fired: true,
        resolution: result.resolution,
      };
    }
  }

  return { fired: false };
}

// ── Cooldown State Management ────────────────────────────────

/**
 * Mark a random event as fired by updating its cooldown state.
 * Mutates the event's cooldown in place.
 */
export function markEventFired(event: RandomEvent, currentDay: number): void {
  event.cooldown.last_fired = currentDay;
}

// ── Apply Random Event Rewards ─────────────────────────────

export interface RewardResult {
  notifications: string[];
}

/**
 * Apply rewards from a random event resolution to game state.
 */
export function applyEventRewards(
  resolution: RandomEventResolution,
  stateManager: StateManager
): RewardResult {
  const notifications: string[] = [];
  const rewards = resolution.rewards;

  // Money
  if (rewards.money !== null && rewards.money !== undefined && rewards.money !== 0) {
    stateManager.adjustBalance(rewards.money);
    notifications.push(`Money ${rewards.money > 0 ? '+' : ''}${rewards.money}`);
  }

  // Items
  if (rewards.items && rewards.items.length > 0) {
    for (const itemId of rewards.items) {
      // Infer item type (default to consumable if not in inventory)
      let itemType: 'consumable' | 'key_item' | 'gift' = 'consumable';
      const inv = stateManager.getState().player.inventory;
      if (inv.key_items[itemId]) itemType = 'key_item';
      else if (inv.gifts[itemId]) itemType = 'gift';
      
      stateManager.grantItem(itemId, 1, itemType);
      notifications.push(`Received ${itemId}`);
    }
  }

  // Stat bumps
  if (rewards.stat_bumps) {
    for (const [statId, value] of Object.entries(rewards.stat_bumps)) {
      stateManager.bumpPlayerStat(statId, value);
      notifications.push(`${statId} ${value > 0 ? '+' : ''}${value}`);
    }
  }

  return { notifications };
}
