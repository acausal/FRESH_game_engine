// ============================================================
// dialogue.ts — Dialogue graph system
// A dialogue is a graph of nodes belonging to one NPC. The player
// advances by choosing a response; nodes may also auto-route to a
// different node based on world state before choices are shown.
//
// Mirrors events.ts: choice effects reuse ActionEffects and are
// applied through executeAction via a synthetic action, so dialogue
// gets stat bumps, flags, items, quest triggers, etc. for free.
// ============================================================

import {
  Dialogue,
  DialogueNode,
  DialogueChoice,
  DialogueRoute,
  GameState,
  Action,
} from './types';
import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import { executeAction, ActionResult } from './actions';

// ── Load ──────────────────────────────────────────────────────

// BEGIN: Load dialogue by ID
export function loadDialogue(
  dialogues: Record<string, Dialogue>,
  dialogue_id: string
): Dialogue | null {
  return dialogues[dialogue_id] || null;
}
// END: Load dialogue by ID

// ── Conditional Routing ───────────────────────────────────────

// BEGIN: Resolve active node
// Given a starting node, follow conditional routes until a node with
// no matching route is reached. First route whose conditions all pass
// wins. A depth guard prevents infinite redirect loops from cyclic
// or self-referential route data.
const MAX_ROUTE_HOPS = 32;

export function resolveActiveNode(
  dialogue: Dialogue,
  startNodeId: string,
  state: GameState,
  evaluator: ConditionEvaluator
): DialogueNode | null {
  let currentId: string | null = startNodeId;
  let hops = 0;

  while (currentId && hops < MAX_ROUTE_HOPS) {
    const node: DialogueNode | undefined = dialogue.nodes[currentId];
    if (!node) return null;

    const routes: DialogueRoute[] | null = node.routes;
    if (!routes || routes.length === 0) {
      return node;
    }

    const match: DialogueRoute | undefined = routes.find((route: DialogueRoute) =>
      evaluator.evaluateAll(route.conditions, state)
    );

    if (!match) {
      return node;  // no route fires — stay on this node
    }

    currentId = match.target_node_id;
    hops++;
  }

  // Depth limit hit — return the last resolvable node rather than crash.
  return currentId ? dialogue.nodes[currentId] || null : null;
}
// END: Resolve active node

// ── Response Filtering ────────────────────────────────────────

// BEGIN: Filter available responses
// Return only the node's choices whose prerequisites are satisfied.
export function getAvailableResponses(
  node: DialogueNode,
  state: GameState,
  evaluator: ConditionEvaluator
): DialogueChoice[] {
  return node.choices.filter(choice => {
    if (!choice.prerequisites || choice.prerequisites.length === 0) {
      return true;
    }
    return choice.prerequisites.every(preReq => evaluator.evaluate(preReq, state));
  });
}
// END: Filter available responses

// ── Node Entry ────────────────────────────────────────────────

// BEGIN: Enter node
// Convenience: resolve conditional routing from startNodeId, then
// return the active node with its available responses. Returns null
// if the dialogue or resolved node cannot be found.
export function enterNode(
  dialogue: Dialogue,
  startNodeId: string,
  state: GameState,
  evaluator: ConditionEvaluator
): { node: DialogueNode; available_responses: DialogueChoice[] } | null {
  const node = resolveActiveNode(dialogue, startNodeId, state, evaluator);
  if (!node) return null;
  return {
    node,
    available_responses: getAvailableResponses(node, state, evaluator),
  };
}
// END: Enter node

// ── Response Resolution ───────────────────────────────────────

export interface DialogueChoiceResult extends ActionResult {
  next_node_id: string | null;  // node to advance to; null ends the conversation
}

// BEGIN: Resolve dialogue choice
// Validate the chosen response, apply its effects (via a synthetic
// action, exactly like resolveEventChoice), and report the next node.
export function resolveDialogueChoice(
  node: DialogueNode,
  choiceIndex: number,
  stateManager: StateManager,
  evaluator: ConditionEvaluator
): DialogueChoiceResult {
  if (choiceIndex < 0 || choiceIndex >= node.choices.length) {
    return {
      success: false,
      reason: `Invalid response index: ${choiceIndex} (node has ${node.choices.length} responses)`,
      effects: [],
      quest_triggers: [],
      next_node_id: null,
    };
  }

  const choice = node.choices[choiceIndex];

  // Re-verify prerequisites against live state (defense vs. stale UI).
  if (choice.prerequisites && choice.prerequisites.length > 0) {
    const prereqsMet = evaluator.evaluateAll(choice.prerequisites, stateManager.getState());
    if (!prereqsMet) {
      return {
        success: false,
        reason: 'Response prerequisites no longer met.',
        effects: [],
        quest_triggers: [],
        next_node_id: null,
      };
    }
  }

  // Synthetic action reuses executeAction's effect-application + quest
  // logic. No visibility/caps/prerequisites so it goes straight to effects.
  const syntheticAction: Action = {
    id: `dialogue_choice_${node.id}_${choiceIndex}`,
    name: choice.text,
    description: '',
    action_type: 'npc_interaction',
    context: { type: 'npc', target_id: '' },
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

  const result = executeAction(syntheticAction, stateManager, evaluator, undefined);

  return {
    ...result,
    next_node_id: result.success ? choice.next_node_id : null,
  };
}
// END: Resolve dialogue choice
