// ============================================================
// actions.ts — Action system
// Resolves visibility, availability, and executes action effects.
// Pure functions — no internal state.
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import { expandText } from './grammar';
import {
  Action,
  GameState,
  GlobalEmission,
} from './types';
import { QuestManager } from './quest';
import { evaluateActionEvents, markEventFired, applyEventRewards } from './random_events';

// ── Resolution Results ───────────────────────────────────────

export type ActionVisibility =
  | { visible: true }
  | { visible: false };

export type UnavailableReason =
  | 'daily_cap_exhausted'
  | 'lifetime_cap_exhausted'
  | 'insufficient_funds'
  | 'missing_item'
  | 'flag_condition_not_met'
  | 'shop_not_found'
  | 'no_item_specified'
  | 'shop_item_unavailable'
  | 'shop_item_locked'
  | 'shop_out_of_stock'
  | 'shop_locked';

export type ActionAvailability =
  | { available: true }
  | { available: false; reason: UnavailableReason; when_exhausted: 'hide' | 'grey_out' };

export interface ActionStatus {
  action: Action;
  visibility: ActionVisibility;
  availability: ActionAvailability | null;  // null if not visible
}

// ── Execution Result ─────────────────────────────────────────

export interface ActionEffect {
  kind:
    | 'text'
    | 'scene'
    | 'stat_bump'
    | 'npc_affection'
    | 'npc_corruption'
    | 'npc_trait_bump'
    | 'npc_flag_set'
    | 'money_delta'
    | 'player_flag_set'
    | 'global_emission'
    | 'quest_triggered'
    | 'item_consumed'
    | 'item_granted';
  detail: string;   // human-readable summary for console narration
}

export interface ActionResult {
  success: boolean;
  reason?: string;          // why it failed if not success
  effects: ActionEffect[];  // what happened, in order
  quest_triggers: string[]; // quest_ids to be processed by quest system
}

// ── Visibility Resolution ─────────────────────────────────────

export function resolveVisibility(
  action: Action,
  state: GameState,
  evaluator: ConditionEvaluator
): ActionVisibility {
  const { conditions } = action.visibility;

  // No conditions = always visible
  if (!conditions || conditions.length === 0) {
    return { visible: true };
  }

  const visible = evaluator.evaluateAll(conditions, state);
  return visible ? { visible: true } : { visible: false };
}

// ── Availability Resolution ───────────────────────────────────

export function resolveAvailability(
  action: Action,
  state: GameState,
  evaluator: ConditionEvaluator
): ActionAvailability {
  const { caps, prerequisites } = action.availability;

  // Check daily cap
  if (caps.daily.enabled) {
    if (caps.daily.current >= (caps.daily.max ?? Infinity)) {
      return {
        available: false,
        reason: 'daily_cap_exhausted',
        when_exhausted: caps.daily.when_exhausted,
      };
    }
  }

  // Check lifetime cap
  if (caps.lifetime.enabled) {
    if (caps.lifetime.current >= (caps.lifetime.max ?? Infinity)) {
      return {
        available: false,
        reason: 'lifetime_cap_exhausted',
        when_exhausted: caps.lifetime.when_exhausted,
      };
    }
  }

  // Check money prerequisite
  if (prerequisites.money !== null) {
    if (state.player.economy.balance < prerequisites.money) {
      return {
        available: false,
        reason: 'insufficient_funds',
        when_exhausted: 'grey_out',
      };
    }
  }

  // Check item prerequisites
  if (prerequisites.items && prerequisites.items.length > 0) {
    for (const req of prerequisites.items) {
      const inv = state.player.inventory;
      const hasItem =
        (req.item_id in inv.key_items && inv.key_items[req.item_id]) ||
        (req.item_id in inv.consumables && inv.consumables[req.item_id].quantity > 0) ||
        (req.item_id in inv.gifts && inv.gifts[req.item_id].quantity > 0);

      if (!hasItem) {
        return {
          available: false,
          reason: 'missing_item',
          when_exhausted: 'grey_out',
        };
      }
    }
  }

  // Check flag prerequisites
  if (prerequisites.flags && prerequisites.flags.length > 0) {
    const flagsMet = evaluator.evaluateAll(prerequisites.flags, state);
    if (!flagsMet) {
      return {
        available: false,
        reason: 'flag_condition_not_met',
        when_exhausted: 'grey_out',
      };
    }
  }

  // Check shop item availability (for buy_item actions)
  if (action.action_type === 'buy_item' && action.shop_id) {
    const shop = state.shops[action.shop_id];
    
    if (!shop) {
      return {
        available: false,
        reason: 'shop_not_found',
        when_exhausted: 'grey_out',
      };
    }

    // Get item_id from effects.item_grants (for buy_item, the item is granted, not consumed from prerequisites)
    const item_id = action.effects.item_grants?.[0]?.item_id;
    if (!item_id) {
      return {
        available: false,
        reason: 'no_item_specified',
        when_exhausted: 'grey_out',
      };
    }

    const shopItem = shop.inventory.find(inv => inv.item_id === item_id);
    if (!shopItem) {
      return {
        available: false,
        reason: 'shop_item_unavailable',
        when_exhausted: 'grey_out',
      };
    }

    // Check if shop item is unlocked (conditions met)
    if (shopItem.conditions && shopItem.conditions.length > 0) {
      const conditionsMet = evaluator.evaluateAll(shopItem.conditions, state);
      if (!conditionsMet) {
        return {
          available: false,
          reason: 'shop_item_locked',
          when_exhausted: 'grey_out',
        };
      }
    }

    // Check shop inventory quantity
    if (shopItem.quantity !== null && shopItem.quantity < 1) {
      return {
        available: false,
        reason: 'shop_out_of_stock',
        when_exhausted: 'grey_out',
      };
    }

    // Check if shop is unlocked
    if (!shop.unlock.unlocked) {
      if (shop.unlock.conditions && shop.unlock.conditions.length > 0) {
        const shopUnlocked = evaluator.evaluateAll(shop.unlock.conditions, state);
        if (!shopUnlocked) {
          return {
            available: false,
            reason: 'shop_locked',
            when_exhausted: 'grey_out',
          };
        }
      }
    }
  }

  return { available: true };
}

// ── Full Status Query ─────────────────────────────────────────
// Returns visibility + availability for a single action.

export function getActionStatus(
  action: Action,
  state: GameState,
  evaluator: ConditionEvaluator
): ActionStatus {
  const visibility = resolveVisibility(action, state, evaluator);

  if (!visibility.visible) {
    return { action, visibility, availability: null };
  }

  const availability = resolveAvailability(action, state, evaluator);
  return { action, visibility, availability };
}

// ── Context Query ─────────────────────────────────────────────
// Returns all actions for a given NPC or location context,
// filtered to visible ones only (hidden = don't show at all).

export function getContextActions(
  actions: Action[],
  contextType: 'npc' | 'location',
  contextId: string,
  state: GameState,
  evaluator: ConditionEvaluator
): ActionStatus[] {
  return actions
    .filter(a => a.context.type === contextType && a.context.target_id === contextId)
    .map(a => getActionStatus(a, state, evaluator))
    .filter(status => status.visibility.visible);
}

// ── Action Execution ──────────────────────────────────────────

// Resolve an item's type from the authoritative item registry. Falls back to
// 'consumable' when the item isn't registered (keeps legacy/unknown items
// grantable without crashing).
function inferItemType(state: GameState, itemId: string): 'consumable' | 'key_item' | 'gift' {
  const item = state.items[itemId];
  return item ? item.item_type : 'consumable';
}

export function executeAction(
  action: Action,
  stateManager: StateManager,
  evaluator: ConditionEvaluator,
  locationData?: Record<string, any> | null
): ActionResult {
  const state = stateManager.getState();
  const effects: ActionEffect[] = [];
  const quest_triggers: string[] = [];

  // ── Pre-execution checks ──────────────────────────────────

  const visibility = resolveVisibility(action, state, evaluator);
  if (!visibility.visible) {
    return { success: false, reason: 'Action is not visible.', effects: [], quest_triggers: [] };
  }

  const availability = resolveAvailability(action, state, evaluator);
  if (availability.available === false) {
    return {
      success: false,
      reason: `Action unavailable: ${availability.reason}`,
      effects: [],
      quest_triggers: [],
    };
  }

  // ── Step 1: Consume prerequisites ────────────────────────
  // Money and items are consumed before effects are applied.
  // If anything fails here the action was available but something
  // went wrong — treat as an error rather than a soft failure.

  const { prerequisites } = action.availability;

  // Spend money (negative delta)
  if (prerequisites.money !== null && prerequisites.money > 0) {
    const spent = stateManager.adjustBalance(-prerequisites.money);
    if (!spent) {
      return {
        success: false,
        reason: 'Insufficient funds (race condition).',
        effects: [],
        quest_triggers: [],
      };
    }
  }

  // Consume items marked as consumed_on_use
  if (prerequisites.items) {
    for (const req of prerequisites.items) {
      if (req.consumed_on_use) {
        const inv = state.player.inventory;
        if (req.item_id in inv.consumables) {
          stateManager.consumeItem(req.item_id, 1, 'consumable');
          effects.push({
            kind: 'item_consumed',
            detail: `Used ${req.item_id}.`,
          });
        } else if (req.item_id in inv.gifts) {
          stateManager.consumeItem(req.item_id, 1, 'gift');
          effects.push({
            kind: 'item_consumed',
            detail: `Used ${req.item_id}.`,
          });
        } else if (req.item_id in inv.key_items) {
          stateManager.consumeItem(req.item_id, 1, 'key_item');
          effects.push({
            kind: 'item_consumed',
            detail: `Used ${req.item_id}.`,
          });
        }
      }
    }
  }

  // ── Step 2: Increment daily cap ───────────────────────────

  if (action.availability.caps.daily.enabled) {
    action.availability.caps.daily.current += 1;
  }
  if (action.availability.caps.lifetime.enabled) {
    action.availability.caps.lifetime.current += 1;
  }

  // ── Step 3: Apply effects ─────────────────────────────────

  const { effects: fx } = action;

  // Narrative text (static or grammar-based)
  let narrativeText: string | null = null;
  if (fx.text) {
    // Static text takes priority
    narrativeText = fx.text;
  } else if ((fx as any).text_key) {
    // Grammar-based text lookup
    narrativeText = expandText((fx as any).text_key);
  }
  if (narrativeText) {
    effects.push({ kind: 'text', detail: narrativeText });
  }

  // Scene reference
  if (fx.scene_id) {
    effects.push({ kind: 'scene', detail: fx.scene_id });
  }

  // Player stat bump
  if (fx.stat_bumps) {
    const changes = stateManager.bumpPlayerStat(fx.stat_bumps.stat_id, fx.stat_bumps.value);
    effects.push({
      kind: 'stat_bump',
      detail: `${fx.stat_bumps.stat_id} ${fx.stat_bumps.value > 0 ? '+' : ''}${fx.stat_bumps.value}`,
    });
    // Threshold crossings are already written to global state by bumpPlayerStat
  }

  // NPC effects
  if (fx.npc_effects) {
    const { npc_id, affection, corruption, trait_bumps, flags: npcFlags } = fx.npc_effects;

    if (affection !== null && affection !== undefined) {
      stateManager.bumpNPCAxis(npc_id, 'affection', affection, {});
      effects.push({
        kind: 'npc_affection',
        detail: `${npc_id} affection ${affection > 0 ? '+' : ''}${affection}`,
      });
    }

    if (corruption !== null && corruption !== undefined) {
      stateManager.bumpNPCAxis(npc_id, 'corruption', corruption, {});
      effects.push({
        kind: 'npc_corruption',
        detail: `${npc_id} corruption ${corruption > 0 ? '+' : ''}${corruption}`,
      });
    }

    if (trait_bumps) {
      stateManager.bumpNPCTrait(npc_id, trait_bumps.trait_id, trait_bumps.value);
      effects.push({
        kind: 'npc_trait_bump',
        detail: `${npc_id} ${trait_bumps.trait_id} ${trait_bumps.value > 0 ? '+' : ''}${trait_bumps.value}`,
      });
    }

    if (npcFlags) {
      stateManager.setNPCFlags(npc_id, npcFlags);
      for (const [flagId, val] of Object.entries(npcFlags)) {
        effects.push({
          kind: 'npc_flag_set',
          detail: `${npc_id}.${flagId} = ${val}`,
        });
      }
    }
  }

  // Money delta (gain or cost from action itself, separate from prerequisites)
  if (fx.money_delta !== null && fx.money_delta !== undefined) {
    if (fx.money_delta < 0) {
      const spent = stateManager.adjustBalance(fx.money_delta);
      if (!spent) {
        // Edge case: action has a cost in effects (not prerequisites)
        // This shouldn't normally happen but handle gracefully
        return {
          success: false,
          reason: 'Insufficient funds for action effect.',
          effects,
          quest_triggers,
        };
      }
    } else {
      stateManager.adjustBalance(fx.money_delta);
    }
    effects.push({
      kind: 'money_delta',
      detail: `Balance ${fx.money_delta > 0 ? '+' : ''}${fx.money_delta}`,
    });
  }

  // Player flags
  if (fx.player_flags) {
    stateManager.setPlayerFlags(fx.player_flags);
    for (const [flagId, val] of Object.entries(fx.player_flags)) {
      effects.push({
        kind: 'player_flag_set',
        detail: `player.${flagId} = ${val}`,
      });
    }
  }

  // Global emissions
  if (fx.global_emissions) {
    stateManager.emitGlobal(fx.global_emissions);
    for (const emission of fx.global_emissions) {
      effects.push({
        kind: 'global_emission',
        detail: `global.${emission.flag} = ${emission.value}`,
      });
    }
  }

  // Item grants (crafting, drops, etc.)
  if (fx.item_grants) {
    for (const grant of fx.item_grants) {
      // Resolve item type from the authoritative item registry, not from the
      // player's current inventory (a brand-new key item isn't there yet and
      // would otherwise be misclassified as a consumable).
      const itemType = inferItemType(state, grant.item_id);
      stateManager.grantItem(grant.item_id, grant.quantity, itemType);
      effects.push({
        kind: 'item_granted',
        detail: `Gained ${grant.item_id} x${grant.quantity}`,
      });
    }
  }

  // Item consumes (crafting recipes, etc.)
  if (fx.item_consumes) {
    for (const consume of fx.item_consumes) {
      const itemType = inferItemType(state, consume.item_id);

      try {
        stateManager.consumeItem(consume.item_id, consume.quantity, itemType);
        effects.push({
          kind: 'item_consumed',
          detail: `Used ${consume.item_id} x${consume.quantity}`,
        });
      } catch (err) {
        // Crafting failed due to insufficient materials
        return {
          success: false,
          reason: (err as Error).message,
          effects,
          quest_triggers,
        };
      }
    }
  }

  // Quest triggers — returned for the caller to handle
  if (fx.quest_triggers && fx.quest_triggers.length > 0) {
    quest_triggers.push(...fx.quest_triggers);
    for (const questId of fx.quest_triggers) {
      effects.push({
        kind: 'quest_triggered',
        detail: `Quest triggered: ${questId}`,
      });
    }
  }

  // ── Action Type Handlers ──────────────────────────────────

  // use_item: apply consumable effects (stat bumps + flavor text)
  if (action.action_type === 'use_item') {
    if (action.availability.prerequisites.items && action.availability.prerequisites.items.length > 0) {
      const itemReq = action.availability.prerequisites.items[0];
      const item = stateManager.getItem(itemReq.item_id);
      
      if (item && item.consumable && item.consumable.effect) {
        // Apply stat bumps from the consumable
        if (item.consumable.effect.stat_bumps) {
          for (const bump of item.consumable.effect.stat_bumps) {
            stateManager.bumpPlayerStat(bump.stat_id, bump.value);
            effects.push({
              kind: 'stat_bump',
              detail: `${bump.stat_id} ${bump.value > 0 ? '+' : ''}${bump.value}`,
            });
          }
        }

        // Add flavor text if present
        if (item.consumable.effect.flavor_text) {
          effects.push({
            kind: 'text',
            detail: item.consumable.effect.flavor_text,
          });
        }
      }
    }
  }

  // give_gift: apply gift effects based on gift type (one_time or repeatable)
  if (action.action_type === 'give_gift') {
    const npc_id = action.context.target_id;
    
    if (action.availability.prerequisites.items && action.availability.prerequisites.items.length > 0) {
      const itemReq = action.availability.prerequisites.items[0];
      const item = stateManager.getItem(itemReq.item_id);
      
      if (item && item.gift) {
        const npc = stateManager.getNPC(npc_id);

        if (item.gift.mode === 'one_time' && item.gift.one_time) {
          // One-time gift: set flags, unlock traits, apply bumps
          const targets = item.gift.one_time.effect.npc_targets;
          const matchingTarget = targets.find(t => !t.npc_id || t.npc_id === npc_id);

          if (matchingTarget) {
            const { flags: giftFlags, trait_unlocks, relationship_bumps } = matchingTarget.on_give;

            if (giftFlags) {
              stateManager.setNPCFlags(npc_id, giftFlags);
              for (const [flagId, val] of Object.entries(giftFlags)) {
                effects.push({
                  kind: 'npc_flag_set',
                  detail: `${npc_id}.${flagId} = ${val}`,
                });
              }
            }

            if (trait_unlocks && trait_unlocks.length > 0) {
              for (const traitId of trait_unlocks) {
                if (npc.traits[traitId]) {
                  npc.traits[traitId].unlocked = true;
                  effects.push({
                    kind: 'text',
                    detail: `${npc_id} trait unlocked: ${traitId}`,
                  });
                }
              }
            }

            if (relationship_bumps) {
              if (relationship_bumps.affection !== null && relationship_bumps.affection !== undefined) {
                stateManager.bumpNPCAxis(npc_id, 'affection', relationship_bumps.affection, {});
                effects.push({
                  kind: 'npc_affection',
                  detail: `${npc_id} affection ${relationship_bumps.affection > 0 ? '+' : ''}${relationship_bumps.affection}`,
                });
              }
              if (relationship_bumps.corruption !== null && relationship_bumps.corruption !== undefined) {
                stateManager.bumpNPCAxis(npc_id, 'corruption', relationship_bumps.corruption, {});
                effects.push({
                  kind: 'npc_corruption',
                  detail: `${npc_id} corruption ${relationship_bumps.corruption > 0 ? '+' : ''}${relationship_bumps.corruption}`,
                });
              }
            }
          }
        } else if (item.gift.mode === 'repeatable' && item.gift.repeatable) {
          // Repeatable gift: trait bumps + relationship bumps, respect tier cap
          const targets = item.gift.repeatable.npc_targets;
          const matchingTarget = targets.find(t => !t.npc_id || t.npc_id === npc_id);

          if (matchingTarget) {
            const { trait_bumps, relationship_bumps } = matchingTarget.on_give;

            if (trait_bumps) {
              const currentTier = npc.traits[trait_bumps.trait_id]?.current_tier ?? 0;
              const tierCap = npc.traits[trait_bumps.trait_id]?.tiers[currentTier]?.cap ?? Infinity;
              
              // Only bump if respecting tier cap
              if (currentTier < tierCap) {
                stateManager.bumpNPCTrait(npc_id, trait_bumps.trait_id, trait_bumps.value);
                effects.push({
                  kind: 'npc_trait_bump',
                  detail: `${npc_id} ${trait_bumps.trait_id} ${trait_bumps.value > 0 ? '+' : ''}${trait_bumps.value}`,
                });
              }
            }

            if (relationship_bumps) {
              if (relationship_bumps.affection !== null && relationship_bumps.affection !== undefined) {
                stateManager.bumpNPCAxis(npc_id, 'affection', relationship_bumps.affection, {});
                effects.push({
                  kind: 'npc_affection',
                  detail: `${npc_id} affection ${relationship_bumps.affection > 0 ? '+' : ''}${relationship_bumps.affection}`,
                });
              }
              if (relationship_bumps.corruption !== null && relationship_bumps.corruption !== undefined) {
                stateManager.bumpNPCAxis(npc_id, 'corruption', relationship_bumps.corruption, {});
                effects.push({
                  kind: 'npc_corruption',
                  detail: `${npc_id} corruption ${relationship_bumps.corruption > 0 ? '+' : ''}${relationship_bumps.corruption}`,
                });
              }
            }

            // Increment lifetime_given counter (this is in GameState items, not NPC)
            // We'd need to track this separately — for now, just mark that gift was given
            effects.push({
              kind: 'text',
              detail: `Gave ${item.name} to ${npc.name}`,
            });
          }
        }
      }
    }
  }

  // buy_item: grant item and deduct money
  if (action.action_type === 'buy_item') {
    if (fx.item_grants) {
      // buy_item uses item_grants in effects for the purchase
      for (const grant of fx.item_grants) {
        let itemType: 'consumable' | 'key_item' | 'gift' = 'consumable';
        const item = stateManager.getItem(grant.item_id);
        if (item) {
          if (item.item_type === 'key_item') itemType = 'key_item';
          else if (item.item_type === 'gift') itemType = 'gift';
        }
        
        stateManager.grantItem(grant.item_id, grant.quantity, itemType);
        effects.push({
          kind: 'item_granted',
          detail: `Bought ${grant.item_id} x${grant.quantity}`,
        });
      }
    }
  }

  // ── Quest Evaluation ──────────────────────────────────────────
  // After all effects are applied, use QuestManager to evaluate
  // quest initiations and stage progression.

  const questManager = new QuestManager(state.quests);
  const questResult = questManager.evaluateAfterAction(
    quest_triggers,
    stateManager,
    evaluator
  );

  // Flatten quest results into effects for console display
  for (const init of questResult.initiations) {
    if (init.notification) {
      effects.push({ kind: 'quest_triggered', detail: init.notification });
    }
  }
  for (const completion of questResult.completions) {
    for (const notif of completion.notifications) {
      effects.push({ kind: 'text', detail: notif });
    }
  }
  for (const fail of questResult.failures) {
    effects.push({ kind: 'text', detail: fail.notification });
  }

  // ── Action-Triggered Random Event Evaluation ────────────────
  // After quest evaluation, check if any location random events
  // trigger on this specific action.

  if (locationData && locationData.random_events) {
    const actionEventResult = evaluateActionEvents(
      locationData.random_events,
      action.id,
      stateManager.getState(),
      evaluator
    );

    if (actionEventResult.fired && actionEventResult.resolution) {
      const res = actionEventResult.resolution;

      // Mark cooldown
      const firedEvent = locationData.random_events.find(
        (e: any) => e.event_id === res.event_id
      );
      if (firedEvent) {
        markEventFired(firedEvent, state.global.day.count);
      }

      // Add event text
      effects.push({ kind: 'text', detail: res.text });

      // Apply rewards
      const rewardResult = applyEventRewards(res, stateManager);
      for (const notif of rewardResult.notifications) {
        effects.push({ kind: 'text', detail: notif });
      }
    }
  }

  return { success: true, effects, quest_triggers };
}
