// ============================================================
// state.ts — Game state manager
// All reads and writes to game state go through here.
// No system should mutate state directly.
// ============================================================

import {
  GameState,
  GlobalState,
  NPC,
  Player,
  FlagMap,
  ConditionValue,
  QuestStatus,
  GlobalEmission,
} from './types';

// ── Change Records ───────────────────────────────────────────
// Returned by write operations so callers know what happened.
// The rest cycle and other systems react to these.

export interface StatThresholdCrossed {
  kind: 'stat_threshold_crossed';
  entity: 'player';
  stat_id: string;
  global_flag: string;
  value: ConditionValue;
}

export interface NPCTierCapReached {
  kind: 'npc_tier_cap_reached';
  npc_id: string;
  trait_id: string;   // 'affection' | 'corruption' | trait_id
  tier: number;
}

export interface NPCEmitTriggered {
  kind: 'npc_emit_triggered';
  npc_id: string;
  global_flag: string;
  value: ConditionValue;
}

export type StateChange =
  | StatThresholdCrossed
  | NPCTierCapReached
  | NPCEmitTriggered;

// ── State Manager ────────────────────────────────────────────

export class StateManager {
  private state: GameState;

  constructor(state: GameState) {
    this.state = state;
  }

  // ── Getters ─────────────────────────────────────────────────

  getState(): GameState {
    return this.state;
  }

  getGlobal(): GlobalState {
    return this.state.global;
  }

  getPlayer(): Player {
    return this.state.player as unknown as Player;
  }

  getNPC(npc_id: string): NPC {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);
    return npc as unknown as NPC;
  }

  getNPCIds(): string[] {
    return Object.keys(this.state.npcs);
  }

  getItem(item_id: string): import('./types').Item | undefined {
    return this.state.items[item_id];
  }

  getShopsAtLocation(location_id: string): import('./types').Shop[] {
    return Object.values(this.state.shops).filter(shop => shop.location_id === location_id);
  }

  getShopItem(shop_id: string, item_id: string): import('./types').ShopInventoryItem | undefined {
    const shop = this.state.shops[shop_id];
    if (!shop) return undefined;
    return shop.inventory.find(item => item.item_id === item_id);
  }

  getQuest(quest_id: string): import('./types').Quest | undefined {
    return this.state.quests[quest_id];
  }

  getQuestStatus(quest_id: string): import('./types').QuestStatus | undefined {
    return this.state.global.quest_states[quest_id];
  }

  startQuest(quest_id: string, day: number, phase: number): void {
    const status = this.state.global.quest_states[quest_id];
    if (status) {
      status.current_stage_index = 0;
      status.started_at = { day, phase };
      status.stage_started_at = { day, phase };
      status.completed = false;
      status.failed = false;
    }
  }

  advanceQuestStage(quest_id: string, day: number, phase: number): void {
    const status = this.state.global.quest_states[quest_id];
    if (status) {
      status.current_stage_index++;
      status.stage_started_at = { day, phase };
    }
  }

  completeQuest(quest_id: string): void {
    const status = this.state.global.quest_states[quest_id];
    if (status) {
      status.completed = true;
    }
  }

  failQuest(quest_id: string): void {
    const status = this.state.global.quest_states[quest_id];
    if (status) {
      status.failed = true;
    }
  }

  getGlobalFlag(flag_id: string): ConditionValue {
    return this.state.global.flags[flag_id] ?? null;
  }

  getPlayerFlag(flag_id: string): ConditionValue {
    return this.state.player.flags[flag_id] ?? null;
  }

  getNPCFlag(npc_id: string, flag_id: string): ConditionValue {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);
    return npc.flags[flag_id] ?? null;
  }

  getCurrentLocation(): string {
    return this.state.global.current_location_id;
  }

  isLocationUnlocked(location_id: string): boolean {
    return this.state.global.unlocked_locations.includes(location_id);
  }

  isShopUnlocked(shop_id: string): boolean {
    return this.state.global.unlocked_shops.includes(shop_id);
  }

  // ── Player Writes ────────────────────────────────────────────

  // Bump a player stat by delta, clamped to [0, max].
  // Returns any threshold crossings that occurred.
  bumpPlayerStat(stat_id: string, delta: number): StateChange[] {
    const stat = this.state.player.stats[stat_id];
    if (!stat) throw new Error(`Player stat not found: ${stat_id}`);

    const before = stat.value;
    stat.value = Math.max(0, Math.min(stat.max, stat.value + delta));

    const changes: StateChange[] = [];

    // Check threshold crossings (only on increases)
    if (delta > 0 && stat.thresholds) {
      for (const threshold of stat.thresholds) {
        if (before < threshold.value && stat.value >= threshold.value) {
          // Write to global flags immediately
          this.state.global.flags[threshold.global_flag] = true;
          changes.push({
            kind: 'stat_threshold_crossed',
            entity: 'player',
            stat_id,
            global_flag: threshold.global_flag,
            value: true,
          });
        }
      }
    }

    return changes;
  }

  setPlayerFlag(flag_id: string, value: ConditionValue): void {
    this.state.player.flags[flag_id] = value;
  }

  setPlayerFlags(flags: FlagMap): void {
    Object.assign(this.state.player.flags, flags);
  }

  // Add money — negative delta is a cost, positive is a gain.
  // Returns false if insufficient funds for a cost.
  adjustBalance(delta: number): boolean {
    const newBalance = this.state.player.economy.balance + delta;
    if (newBalance < 0) return false;
    this.state.player.economy.balance = newBalance;
    return true;
  }

  addItemToInventory(item_id: string, item_type: 'consumable' | 'gift', quantity: number = 1): void {
    const inv = this.state.player.inventory;
    if (item_type === 'consumable') {
      if (inv.consumables[item_id]) {
        inv.consumables[item_id].quantity += quantity;
      } else {
        inv.consumables[item_id] = { quantity };
      }
    } else {
      if (inv.gifts[item_id]) {
        inv.gifts[item_id].quantity += quantity;
      } else {
        inv.gifts[item_id] = { quantity };
      }
    }
  }

  addKeyItem(item_id: string): void {
    this.state.player.inventory.key_items[item_id] = true;
  }

  removeKeyItem(item_id: string): void {
    this.state.player.inventory.key_items[item_id] = false;
  }

  incrementPlayerDailyCounter(counter_id: string): boolean {
    const counter = this.state.player.daily_counters[counter_id];
    if (!counter) throw new Error(`Player daily counter not found: ${counter_id}`);
    if (counter.current >= counter.max) return false;
    counter.current += 1;
    return true;
  }

  // ── NPC Writes ───────────────────────────────────────────────

  // Bump an NPC axis (affection or corruption) by delta, clamped to [0, current tier cap].
  // Returns tier cap reached events and any emit triggers.
  bumpNPCAxis(
    npc_id: string,
    axis: 'affection' | 'corruption',
    delta: number,
    npcs_full: Record<string, NPC>
  ): StateChange[] {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);

    const axisData = npc[axis];
    const before = axisData.value;

    // For now treat the high_threshold as the cap for tier 0
    // The rest cycle handles actual tier advancement
    axisData.value = Math.max(0, Math.min(axisData.high_threshold, axisData.value + delta));

    const changes: StateChange[] = [];

    // Check if cap reached
    if (axisData.value >= axisData.high_threshold && before < axisData.high_threshold) {
      changes.push({
        kind: 'npc_tier_cap_reached',
        npc_id,
        trait_id: axis,
        tier: 0,
      });
    }

    // Check NPC emits
    const fullNPC = npcs_full[npc_id];
    if (fullNPC?.emits) {
      for (const emit of fullNPC.emits) {
        // Emits are evaluated by the rest cycle via the condition evaluator
        // Here we just note that emits exist and should be checked
        // The rest cycle processes them with full evaluator access
      }
    }

    return changes;
  }

  // Bump an NPC trait value, respecting the current tier cap.
  // Returns tier cap reached event if cap is hit.
  bumpNPCTrait(npc_id: string, trait_id: string, delta: number): StateChange[] {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);

    const trait = npc.traits[trait_id];
    if (!trait) throw new Error(`Trait not found: ${trait_id} on NPC ${npc_id}`);
    if (!trait.unlocked) throw new Error(`Trait not unlocked: ${trait_id} on NPC ${npc_id}`);

    const currentTierData = trait.tiers[trait.current_tier];
    if (!currentTierData) throw new Error(`Tier data missing for ${trait_id} tier ${trait.current_tier}`);

    const before = currentTierData.value;
    currentTierData.value = Math.max(0, Math.min(currentTierData.cap, currentTierData.value + delta));

    const changes: StateChange[] = [];

    if (currentTierData.value >= currentTierData.cap && before < currentTierData.cap) {
      changes.push({
        kind: 'npc_tier_cap_reached',
        npc_id,
        trait_id,
        tier: trait.current_tier,
      });
    }

    return changes;
  }

  unlockNPCTrait(npc_id: string, trait_id: string): void {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);
    const trait = npc.traits[trait_id];
    if (!trait) throw new Error(`Trait not found: ${trait_id} on NPC ${npc_id}`);
    trait.unlocked = true;
  }

  // Advance an NPC trait to the next tier.
  // Resets tier value to 0 and increments current_tier.
  advanceNPCTrait(npc_id: string, trait_id: string): void {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);

    const trait = npc.traits[trait_id];
    if (!trait) throw new Error(`Trait not found: ${trait_id} on NPC ${npc_id}`);

    if (trait.current_tier >= trait.tiers.length - 1) {
      throw new Error(`Already at max tier: ${trait_id} on NPC ${npc_id}`);
    }

    // Reset current tier value, advance tier
    trait.tiers[trait.current_tier].value = 0;
    trait.current_tier += 1;
  }

  setNPCFlag(npc_id: string, flag_id: string, value: ConditionValue): void {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);
    npc.flags[flag_id] = value;
  }

  setNPCFlags(npc_id: string, flags: FlagMap): void {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);
    Object.assign(npc.flags, flags);
  }

  incrementNPCDailyCounter(npc_id: string, counter_id: string): boolean {
    const npc = this.state.npcs[npc_id];
    if (!npc) throw new Error(`NPC not found: ${npc_id}`);
    const counter = npc.daily_counters[counter_id];
    if (!counter) throw new Error(`NPC daily counter not found: ${counter_id}`);
    if (counter.current >= counter.max) return false;
    counter.current += 1;
    return true;
  }

  // ── Global State Writes ──────────────────────────────────────

  setGlobalFlag(flag_id: string, value: ConditionValue): void {
    this.state.global.flags[flag_id] = value;
  }

  setGlobalFlags(flags: FlagMap): void {
    Object.assign(this.state.global.flags, flags);
  }

  emitGlobal(emissions: GlobalEmission[]): void {
    for (const emission of emissions) {
      this.state.global.flags[emission.flag] = emission.value;
    }
  }

  setQuestStatus(quest_id: string, status: QuestStatus): void {
    this.state.global.quest_states[quest_id] = status;
  }

  unlockLocation(location_id: string): void {
    if (!this.state.global.unlocked_locations.includes(location_id)) {
      this.state.global.unlocked_locations.push(location_id);
    }
  }

  unlockShop(shop_id: string): void {
    if (!this.state.global.unlocked_shops.includes(shop_id)) {
      this.state.global.unlocked_shops.push(shop_id);
    }
  }

  setLocation(location_id: string): void {
    this.state.global.previous_location_id = this.state.global.current_location_id;
    this.state.global.current_location_id = location_id;
  }

  advanceWorldPhase(): void {
    this.state.global.world_phase.current += 1;
  }

  queueNotification(message: string): void {
    this.state.global.overnight_eval.pending_notifications.push(message);
  }

  flushNotifications(): string[] {
    const notifications = [...this.state.global.overnight_eval.pending_notifications];
    this.state.global.overnight_eval.pending_notifications = [];
    return notifications;
  }

  // ── Daily Reset ──────────────────────────────────────────────

  resetAllDailyCounters(): void {
    // Player counters
    for (const counter of Object.values(this.state.player.daily_counters)) {
      counter.current = 0;
    }
    // NPC counters
    for (const npc of Object.values(this.state.npcs)) {
      for (const counter of Object.values(npc.daily_counters)) {
        counter.current = 0;
      }
    }
  }

  advanceDay(): void {
    this.state.global.day.count += 1;
  }

  clearRested(): void {
    this.state.global.day.rested = false;
  }

  setRested(): void {
    this.state.global.day.rested = true;
  }

  payWeeklyIncome(): void {
    const economy = this.state.player.economy;
    economy.balance += economy.weekly_income;
  }

  // ── Inventory ────────────────────────────────────────────────

  // Grant item to player inventory. Infers type and adds to appropriate category.
  grantItem(item_id: string, quantity: number, itemType: 'consumable' | 'key_item' | 'gift'): void {
    const inventory = this.state.player.inventory;

    switch (itemType) {
      case 'consumable':
        if (!inventory.consumables[item_id]) {
          inventory.consumables[item_id] = { quantity: 0 };
        }
        inventory.consumables[item_id].quantity += quantity;
        break;

      case 'key_item':
        inventory.key_items[item_id] = true;
        break;

      case 'gift':
        if (!inventory.gifts[item_id]) {
          inventory.gifts[item_id] = { quantity: 0 };
        }
        inventory.gifts[item_id].quantity += quantity;
        break;
    }
  }

  // Consume item from inventory. Returns false if insufficient quantity.
  consumeItem(item_id: string, quantity: number, itemType: 'consumable' | 'key_item' | 'gift'): boolean {
    const inventory = this.state.player.inventory;

    switch (itemType) {
      case 'consumable': {
        const item = inventory.consumables[item_id];
        if (!item || item.quantity < quantity) {
          return false;
        }
        item.quantity -= quantity;
        return true;
      }

      case 'key_item':
        if (!inventory.key_items[item_id]) {
          return false;
        }
        // Key items are boolean; "consume" means remove
        delete inventory.key_items[item_id];
        return true;

      case 'gift': {
        const item = inventory.gifts[item_id];
        if (!item || item.quantity < quantity) {
          return false;
        }
        item.quantity -= quantity;
        return true;
      }
    }

    return false;
  }
}
