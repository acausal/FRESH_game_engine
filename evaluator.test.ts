// ============================================================
// evaluator.ts — Unified condition evaluator
// The spine of the engine. Every gating decision resolves here.
// ============================================================

import {
  Condition,
  ConditionExpression,
  ConditionReference,
  ConditionLibrary,
  ConditionValue,
  GameState,
  QuestStatus,
} from './types';

// ── Type Guards ──────────────────────────────────────────────

function isCondition(c: Condition | ConditionExpression): c is Condition {
  return 'type' in c;
}

function isExpression(c: Condition | ConditionExpression): c is ConditionExpression {
  return 'operator' in c && ('operands' in c);
}

// ── Operator Evaluation ──────────────────────────────────────

function applyOperator(
  actual: ConditionValue,
  operator: Condition['operator'],
  expected: ConditionValue
): boolean {
  switch (operator) {
    case 'gte': return Number(actual) >= Number(expected);
    case 'lte': return Number(actual) <= Number(expected);
    case 'gt':  return Number(actual) >  Number(expected);
    case 'lt':  return Number(actual) <  Number(expected);
    case 'eq':  return actual === expected;
    case 'neq': return actual !== expected;
    case 'has':     return actual !== undefined && actual !== null && actual !== false;
    case 'not_has': return actual === undefined || actual === null || actual === false;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

// ── State Readers ────────────────────────────────────────────
// Each condition type knows how to read the right part of game state.

function readState(condition: Condition, state: GameState): ConditionValue {
  const { type, target_id, value } = condition;

  switch (type) {

    case 'npc_stat': {
      if (!target_id) throw new Error('npc_stat requires target_id (npc_id:stat_name)');
      const [npcId, statName] = target_id.split(':');
      const npc = state.npcs[npcId];
      if (!npc) throw new Error(`NPC not found: ${npcId}`);
      if (statName === 'affection') return npc.affection.value;
      if (statName === 'corruption') return npc.corruption.value;
      throw new Error(`Unknown NPC stat: ${statName}`);
    }

    case 'npc_flag': {
      if (!target_id) throw new Error('npc_flag requires target_id (npc_id:flag_id)');
      const [npcId, flagId] = target_id.split(':');
      const npc = state.npcs[npcId];
      if (!npc) throw new Error(`NPC not found: ${npcId}`);
      return npc.flags[flagId] ?? null;
    }

    case 'npc_trait': {
      // target_id format: "npc_id:trait_id"
      // value = minimum tier required
      if (!target_id) throw new Error('npc_trait requires target_id (npc_id:trait_id)');
      const [npcId, traitId] = target_id.split(':');
      const npc = state.npcs[npcId];
      if (!npc) throw new Error(`NPC not found: ${npcId}`);
      const trait = npc.traits[traitId];
      if (!trait || !trait.unlocked) return 0;
      return trait.current_tier;
    }

    case 'player_stat': {
      if (!target_id) throw new Error('player_stat requires target_id (stat_id)');
      const stat = state.player.stats[target_id];
      if (!stat) throw new Error(`Player stat not found: ${target_id}`);
      return stat.value;
    }

    case 'player_flag': {
      if (!target_id) throw new Error('player_flag requires target_id (flag_id)');
      return state.player.flags[target_id] ?? null;
    }

    case 'player_inventory': {
      if (!target_id) throw new Error('player_inventory requires target_id (item_id)');
      const { consumables, key_items, gifts } = state.player.inventory;
      if (target_id in key_items) return key_items[target_id] ? true : null;
      if (target_id in consumables) return consumables[target_id].quantity > 0 ? consumables[target_id].quantity : null;
      if (target_id in gifts) return gifts[target_id].quantity > 0 ? gifts[target_id].quantity : null;
      return null;
    }

    case 'quest_state': {
      if (!target_id) throw new Error('quest_state requires target_id (quest_id)');
      return state.global.quest_states[target_id]?.completed ?? false;
    }

    case 'world_phase': {
      return state.global.world_phase.current;
    }

    case 'global_flag': {
      if (!target_id) throw new Error('global_flag requires target_id (flag_id)');
      return state.global.flags[target_id] ?? null;
    }

    case 'location_unlocked': {
      if (!target_id) throw new Error('location_unlocked requires target_id (location_id)');
      return state.global.unlocked_locations.includes(target_id);
    }

    case 'day_count': {
      return state.global.day.count;
    }

    case 'daily_counter': {
      // target_id format: "entity_type:entity_id:counter_id"
      // entity_type = 'player' | 'npc'
      if (!target_id) throw new Error('daily_counter requires target_id');
      const parts = target_id.split(':');
      if (parts[0] === 'player') {
        const counter = state.player.daily_counters[parts[1]];
        if (!counter) return 0;
        return counter.max - counter.current; // remaining uses
      } else if (parts[0] === 'npc') {
        const npc = state.npcs[parts[1]];
        if (!npc) throw new Error(`NPC not found: ${parts[1]}`);
        const counter = npc.daily_counters[parts[2]];
        if (!counter) return 0;
        return counter.max - counter.current; // remaining uses
      }
      throw new Error(`Unknown daily_counter target format: ${target_id}`);
    }

    case 'random_chance': {
      // value = probability 0.0 to 1.0
      // Evaluated fresh each call — caller should cache if needed
      return Math.random() < Number(value);
    }

    default:
      throw new Error(`Unknown condition type: ${type}`);
  }
}

// ── Core Evaluator ───────────────────────────────────────────

export class ConditionEvaluator {
  private library: ConditionLibrary;

  constructor(library: ConditionLibrary) {
    this.library = library;
  }

  // Main entry point — resolves a reference and evaluates it
  evaluate(ref: ConditionReference, state: GameState): boolean {
    const resolved = this.resolve(ref);
    if (isCondition(resolved)) {
      return this.evaluateCondition(resolved, state);
    } else {
      return this.evaluateExpression(resolved, state);
    }
  }

  // Resolve a reference to its underlying condition or expression
  resolve(ref: ConditionReference): Condition | ConditionExpression {
    if (ref.ref !== undefined) {
      const named = this.library.conditions[ref.ref];
      if (!named) throw new Error(`Condition not found in library: ${ref.ref}`);
      return named;
    }
    if (ref.inline !== undefined) {
      return ref.inline;
    }
    throw new Error('ConditionReference must have either ref or inline');
  }

  // Evaluate a single atomic condition
  evaluateCondition(condition: Condition, state: GameState): boolean {
    const actual = readState(condition, state);
    return applyOperator(actual, condition.operator, condition.value);
  }

  // Evaluate a logical expression recursively
  evaluateExpression(expression: ConditionExpression, state: GameState): boolean {
    const { operator, operands } = expression;

    switch (operator) {
      case 'AND':
        return operands.every(operand =>
          isCondition(operand)
            ? this.evaluateCondition(operand, state)
            : this.evaluateExpression(operand, state)
        );

      case 'OR':
        return operands.some(operand =>
          isCondition(operand)
            ? this.evaluateCondition(operand, state)
            : this.evaluateExpression(operand, state)
        );

      case 'NOT':
        if (operands.length !== 1) {
          throw new Error('NOT expression must have exactly one operand');
        }
        const operand = operands[0];
        const result = isCondition(operand)
          ? this.evaluateCondition(operand, state)
          : this.evaluateExpression(operand, state);
        return !result;

      default:
        throw new Error(`Unknown logical operator: ${operator}`);
    }
  }

  // Evaluate an array of condition references — all must pass (implicit AND)
  evaluateAll(refs: ConditionReference[], state: GameState): boolean {
    return refs.every(ref => this.evaluate(ref, state));
  }

  // Evaluate an array of condition references — at least one must pass (implicit OR)
  evaluateAny(refs: ConditionReference[], state: GameState): boolean {
    return refs.some(ref => this.evaluate(ref, state));
  }
}
