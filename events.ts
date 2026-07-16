// ============================================================
// events.ts — Event system evaluator
// Events are interactive scenes with player-driven choices.
// Each choice can have prerequisites and state delta effects.
// ============================================================

import { 
  Event, 
  EventChoice, 
  GameState, 
  ConditionReference,
  LocationEventTrigger,
  ActionEffects,
  Action,
} from './types';
import { ConditionEvaluator } from './evaluator';
import { executeAction, ActionResult } from './actions';

// ── Event Evaluator ──────────────────────────────────────────

// BEGIN: Load event by ID
// Returns the full event definition if found, null otherwise.
export function loadEvent(events: Record<string, Event>, event_id: string): Event | null {
  return events[event_id] || null;
}
// END: Load event by ID

// BEGIN: Filter available choices
// Given an event and current game state, return only choices
// whose prerequisites are satisfied.
export function getAvailableChoices(
  event: Event,
  state: GameState,
  evaluator: ConditionEvaluator
): EventChoice[] {
  return event.choices.filter(choice => {
    // If no prerequisites, choice is always available
    if (!choice.prerequisites || choice.prerequisites.length === 0) {
      return true;
    }

    // Evaluate all prerequisites; all must pass
    return choice.prerequisites.every(preReq => {
      return evaluator.evaluate(preReq, state);
    });
  });
}
// END: Filter available choices

// BEGIN: Get event with filtered choices
// Convenience function: load event and return with only available choices.
// Returns null if event not found, or the event with available choices.
export function getEventWithAvailableChoices(
  events: Record<string, Event>,
  event_id: string,
  state: GameState,
  evaluator: ConditionEvaluator
): { event: Event; available_choices: EventChoice[] } | null {
  const event = loadEvent(events, event_id);
  if (!event) {
    return null;
  }

  const available_choices = getAvailableChoices(event, state, evaluator);
  return {
    event,
    available_choices,
  };
}
// END: Get event with available choices

// ── Event Choice Resolution ────────────────────────────────

// BEGIN: Resolve event choice
// Given an event, a choice index, and current game state,
// validates the choice and applies its effects.
// Returns an ActionResult (success/failure + effects + quest triggers).
export function resolveEventChoice(
  event: Event,
  choiceIndex: number,
  stateManager: import('./state').StateManager,
  evaluator: ConditionEvaluator
): ActionResult {
  // Validate choice index
  if (choiceIndex < 0 || choiceIndex >= event.choices.length) {
    return {
      success: false,
      reason: `Invalid choice index: ${choiceIndex} (event has ${event.choices.length} choices)`,
      effects: [],
      quest_triggers: [],
    };
  }

  const choice = event.choices[choiceIndex];

  // Verify prerequisites are still met (defense against stale state)
  if (choice.prerequisites && choice.prerequisites.length > 0) {
    const state = stateManager.getState();
    const prereqsMet = evaluator.evaluateAll(choice.prerequisites, state);
    if (!prereqsMet) {
      return {
        success: false,
        reason: 'Choice prerequisites no longer met.',
        effects: [],
        quest_triggers: [],
      };
    }
  }

  // Create a synthetic Action to reuse executeAction's effect application logic.
  // The synthetic action has no visibility conditions, no caps, and no prerequisites,
  // so executeAction will skip directly to effect application + quest evaluation.
  const syntheticAction: Action = {
    id: `event_choice_${event.id}_${choiceIndex}`,
    name: choice.text,
    description: '',
    action_type: 'location_action',
    context: { type: 'location', target_id: '' },
    visibility: { conditions: [] },
    availability: {
      caps: {
        daily: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: { money: null, items: null, flags: null },
    },
    effects: choice.effects,
    assets: { icon: null },
  };

  return executeAction(syntheticAction, stateManager, evaluator, undefined);
}
// END: Resolve event choice

// ── Event Trigger Evaluation ─────────────────────────────────

// BEGIN: Evaluate location event triggers
// Given a list of location event triggers, return the first event_id
// that passes its probability roll. Returns null if none fire.
// (First-match-wins behavior for multiple events at same location)
export function evaluateLocationEventTrigger(
  triggers: LocationEventTrigger[] | null
): string | null {
  if (!triggers || triggers.length === 0) {
    return null;
  }

  for (const trigger of triggers) {
    const probability = trigger.probability || 1.0;
    if (Math.random() < probability) {
      return trigger.event_id;
    }
  }

  return null;
}
// END: Evaluate location event triggers

// BEGIN: Evaluate action outcome event trigger
// Given action effects, check if an event should fire.
// Returns event_id if it passes probability check, null otherwise.
export function evaluateActionEventTrigger(effects: ActionEffects): string | null {
  if (!effects.event_id) {
    return null;
  }

  const probability = effects.event_probability ?? 1.0;
  if (Math.random() < probability) {
    return effects.event_id;
  }

  return null;
}
// END: Evaluate action outcome event trigger

// BEGIN: Resolve event priority
// Given potential event IDs from different sources (quest, action, location),
// return the one to actually fire, respecting priority:
// Quest > Action > Location
export function resolveEventPriority(
  quest_event_id: string | null,
  action_event_id: string | null,
  location_event_id: string | null
): string | null {
  if (quest_event_id) return quest_event_id;
  if (action_event_id) return action_event_id;
  if (location_event_id) return location_event_id;
  return null;
}
// END: Resolve event priority
