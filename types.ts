// ============================================================
// types.ts — Core type definitions for the game engine
// ============================================================

// ── Condition System ─────────────────────────────────────────

export type ConditionType =
  | 'npc_stat'
  | 'npc_flag'
  | 'npc_trait'
  | 'player_stat'
  | 'player_skill'
  | 'player_flag'
  | 'player_inventory'
  | 'quest_state'
  | 'world_phase'
  | 'global_flag'
  | 'location_unlocked'
  | 'day_count'
  | 'day_of_week'
  | 'week_count'
  | 'daily_counter'
  | 'random_chance';

export type ConditionOperator =
  | 'gte'
  | 'lte'
  | 'gt'
  | 'lt'
  | 'eq'
  | 'neq'
  | 'has'
  | 'not_has';

export type LogicalOperator = 'AND' | 'OR' | 'NOT';

export interface Condition {
  id?: string;
  type: ConditionType;
  target_id?: string;
  operator: ConditionOperator;
  value: ConditionValue;
}

export type ConditionValue = boolean | number | string | null;

export interface ConditionExpression {
  operator: LogicalOperator;
  operands: Array<Condition | ConditionExpression>;
}

export type ConditionReference =
  | { ref: string; inline?: never }
  | { inline: Condition | ConditionExpression; ref?: never };

export interface ConditionLibrary {
  conditions: Record<string, Condition | ConditionExpression>;
}

// ── Shared Primitives ─────────────────────────────────────────

export type FlagMap = Record<string, ConditionValue>;

export interface DailyCounter {
  current: number;
  max: number;
}

export interface StatThreshold {
  value: number;
  global_flag: string;          // emits to global state when crossed
}

export interface SkillTier {
  value: number;
  cap: number;
  advance_conditions: ConditionReference[] | null;  // null = auto-advance
}

// ── Quest ──────────────────────────────────────────────────────

export interface QuestStage {
  id: string;
  description: string;
  completion_conditions: ConditionReference[] | null;
  on_complete: ActionEffects | null;
  on_complete_event_id: string | null;  // guaranteed event on quest stage completion
  fail_conditions: ConditionReference[] | null;
}

export interface Quest {
  id: string;
  name: string;
  description: string;
  visibility: {
    conditions: ConditionReference[] | null;
  };
  auto_start: {
    conditions: ConditionReference[] | null;
  };
  stages: QuestStage[];
}

export interface QuestStatus {
  quest_id: string;
  current_stage_index: number;
  started_at: { day: number; phase: number };
  stage_started_at: { day: number; phase: number };
  completed: boolean;
  failed: boolean;
}

export interface GlobalEmission {
  flag: string;
  value: ConditionValue;
}

// ── NPC ───────────────────────────────────────────────────────

export interface NPCAxis {
  value: number;
  high_threshold: number;
}

export interface NPCTrait {
  unlocked: boolean;
  unlock_conditions: ConditionReference[];
  current_tier: number;
  tiers: SkillTier[];
}

export interface NPCLocation {
  location_id: string;
  conditions: ConditionReference[] | null;
}

export interface NPCEmit {
  condition: ConditionReference;
  global_flag: string;
  value: ConditionValue;
}

export interface NPC {
  id: string;
  name: string;
  description: string;
  locations: NPCLocation[];
  affection: NPCAxis;
  corruption: NPCAxis;
  traits: Record<string, NPCTrait>;
  daily_counters: Record<string, DailyCounter>;
  flags: FlagMap;
  emits: NPCEmit[];
  assets: {
    portrait: string;
    scenes: Record<string, string>;
  };
}

// ── Player ────────────────────────────────────────────────────

export interface PlayerStat {
  value: number;
  max: number;
  thresholds: StatThreshold[];
}

export interface PlayerInventory {
  consumables: Record<string, { quantity: number }>;
  key_items: Record<string, boolean>;
  gifts: Record<string, { quantity: number }>;
}

export interface PlayerEconomy {
  balance: number;
  weekly_income: number;
  income_upgrade_cost: number;
  income_max: number;
}

export interface Player {
  name: string;
  stats: Record<string, PlayerStat>;
  skills: Record<string, NPCTrait>;
  inventory: PlayerInventory;
  economy: PlayerEconomy;
  daily_counters: Record<string, DailyCounter>;
  flags: FlagMap;
  assets: {
    portrait: string;
  };
}

// ── Location ──────────────────────────────────────────────────

export type RandomEventTrigger = 'on_visit' | 'on_action';
export type RandomEventCooldownType = 'none' | 'one_time' | 'per_day' | 'per_phase';

export interface RandomEventCooldown {
  type: RandomEventCooldownType;
  last_fired: number | null;    // day count when last fired
}

export interface RandomEventRewards {
  money: number | null;
  items: string[] | null;       // item_ids
  stat_bumps: Record<string, number> | null;
}

export interface RandomEvent {
  event_id: string;
  conditions: ConditionReference[] | null;
  probability: number;          // 0.0 to 1.0
  trigger: RandomEventTrigger;
  trigger_action_id: string | null;
  cooldown: RandomEventCooldown;
  content: {
    text: string;
    rewards: RandomEventRewards;
  };
}

export interface LocationContents {
  npcs: Array<{ npc_id: string; conditions: ConditionReference[] | null }>;
  shops: Array<{ shop_id: string; conditions: ConditionReference[] | null }>;
  quests: Array<{ quest_id: string; conditions: ConditionReference[] | null }>;
  actions: Array<{ action_id: string; conditions: ConditionReference[] | null }>;
}

export interface LocationEventTrigger {
  event_id: string;
  probability: number;  // 0.0 to 1.0; first-match-wins if multiple
}

export interface Location {
  id: string;
  name: string;
  description: string;
  parent_id: string | null;     // null = world map root
  region: string;
  children: string[];           // location_ids
  unlock: {
    unlocked: boolean;
    conditions: ConditionReference[] | null;
  };
  availability: {
    available: boolean;
    conditions: ConditionReference[] | null;
  };
  contents: LocationContents;
  random_events: RandomEvent[];
  event_triggers: LocationEventTrigger[] | null;
  assets: {
    image: string | null;
    ambient_description: string;
  };
}

// ── Quest ─────────────────────────────────────────────────────

// ── Shop ──────────────────────────────────────────────────────

export type ItemType = 'consumable' | 'key_item' | 'gift';

export interface ShopInventoryItem {
  item_id: string;
  name: string;
  description: string;
  price: number;
  item_type: ItemType;
  quantity: number | null;      // null = unlimited
  conditions: ConditionReference[] | null;
}

export interface Shop {
  id: string;
  name: string;
  description: string;
  location_id: string;
  unlock: {
    unlocked: boolean;
    conditions: ConditionReference[] | null;
  };
  inventory: ShopInventoryItem[];
  assets: {
    shop_image: string | null;
    banner_image: string | null;
  };
}

// ── Item ──────────────────────────────────────────────────────

export interface RelationshipBumps {
  affection: number | null;
  corruption: number | null;
}

export interface GiftTarget {
  npc_id: string | null;        // null = any NPC that accepts tag
  accepted_tags: string[];
}

export interface OneTimeGiftTarget extends GiftTarget {
  on_give: {
    flags: FlagMap;
    trait_unlocks: string[];    // trait_ids
    relationship_bumps: RelationshipBumps;
  };
}

export interface RepeatableGiftTarget extends GiftTarget {
  on_give: {
    trait_bumps: {
      trait_id: string;
      value: number;
    } | null;
    relationship_bumps: RelationshipBumps | null;
  };
  respects_tier_cap: boolean;   // always true, explicit for clarity
}

export interface ItemGift {
  mode: 'one_time' | 'repeatable';
  one_time: {
    effect: {
      npc_targets: OneTimeGiftTarget[];
    };
  } | null;
  repeatable: {
    daily_cap: number | null;
    lifetime_cap: number | null;
    lifetime_given: number;
    npc_targets: RepeatableGiftTarget[];
  } | null;
}

export interface ItemConsumable {
  effect: {
    stat_bumps: Array<{
      stat_id: string;
      value: number;
      temporary: boolean;       // true = cleared on rest
    }> | null;
    flavor_text: string | null;
  };
}

export interface ItemKeyItem {
  quest_related: boolean;
  notes: string | null;         // authoring note, not shown in game
}

export interface Item {
  id: string;
  name: string;
  description: string;
  item_type: ItemType;
  tags: string[] | null;        // for gift NPC targeting
  gift: ItemGift | null;
  consumable: ItemConsumable | null;
  key_item: ItemKeyItem | null;
  assets: {
    image: string | null;
  };
}

// ── Action Effects ────────────────────────────────────────

export interface ActionEffects {
  text: string | null;
  text_key: string | null;  // Grammar key for procedural text (fallback if text is null)
  scene_id: string | null;
  stat_bumps: {
    stat_id: string;
    value: number;
  } | null;
  npc_effects: ActionNPCEffects | null;
  money_delta: number | null;
  player_flags: FlagMap | null;
  global_emissions: GlobalEmission[] | null;
  item_grants: Array<{
    item_id: string;
    quantity: number;
  }> | null;
  item_consumes: Array<{
    item_id: string;
    quantity: number;
  }> | null;
  quest_triggers: string[] | null;  // quest_ids
  event_id: string | null;
  event_probability: number | null;  // 0.0 to 1.0; null = 1.0 if event_id exists
}

// ── Event ────────────────────────────────────────────────────

export interface EventChoice {
  text: string;
  prerequisites: ConditionReference[] | null;
  effects: ActionEffects;
}

export interface Event {
  id: string;
  text: string;
  choices: EventChoice[];
}

// ── Dialogue ──────────────────────────────────────────────────
// A dialogue is a graph of nodes belonging to one NPC. The player
// advances by picking a response; nodes can also auto-route to a
// different node based on world state (conditional routing) before
// any response is shown.

export interface DialogueRoute {
  // First route whose conditions all pass wins; target becomes the
  // active node. Use for "if corruption high, greet differently".
  conditions: ConditionReference[];
  target_node_id: string;
}

export interface DialogueChoice {
  text: string;
  prerequisites: ConditionReference[] | null;  // gated responses
  effects: ActionEffects;                       // reuses the action effects engine
  next_node_id: string | null;                  // null = end conversation
}

export interface DialogueNode {
  id: string;
  text: string;
  speaker: string | null;   // display name override; null = the NPC
  // Optional conditional auto-routing evaluated on node entry, before
  // choices are shown. First matching route redirects to its target.
  routes: DialogueRoute[] | null;
  choices: DialogueChoice[];
}

export interface Dialogue {
  id: string;
  npc_id: string;
  root_node_id: string;
  nodes: Record<string, DialogueNode>;
}

// ── Action ────────────────────────────────────────────────────

export type ActionType =
  | 'npc_interaction'
  | 'location_action'
  | 'give_gift'
  | 'use_item'
  | 'buy_item'
  | 'job'
  | 'rest';

export type ExhaustedBehavior = 'hide' | 'grey_out';

export interface ActionCap {
  enabled: boolean;
  max: number | null;
  current: number;
  when_exhausted: ExhaustedBehavior;
}

export interface ActionPrerequisites {
  money: number | null;
  items: Array<{
    item_id: string;
    consumed_on_use: boolean;
  }> | null;
  flags: ConditionReference[] | null;
}

export interface ActionNPCEffects {
  npc_id: string;
  affection: number | null;
  corruption: number | null;
  trait_bumps: {
    trait_id: string;
    value: number;
  } | null;
  flags: FlagMap | null;
}

export interface Action {
  id: string;
  name: string;
  description: string;
  action_type: ActionType;
  context: {
    type: 'npc' | 'location';
    target_id: string;
  };
  shop_id?: string;  // for buy_item actions, identifies the shop
  visibility: {
    conditions: ConditionReference[] | null;
  };
  availability: {
    caps: {
      daily: ActionCap;
      lifetime: ActionCap;
    };
    prerequisites: ActionPrerequisites;
  };
  effects: ActionEffects;
  assets: {
    icon: string | null;
  };
}

// ── Global State ──────────────────────────────────────────────

export interface WorldPhaseDefinition {
  phase_number: number;
  name: string;
  description: string;
  advancement_conditions: ConditionReference[];
  on_advance: {
    global_flags: FlagMap;
    notifications: string[];
    unlocks: string[];          // location_ids, shop_ids, quest_ids
  };
}

export interface GlobalState {
  current_location_id: string;
  previous_location_id: string | null;
  world_phase: {
    current: number;
    phases: WorldPhaseDefinition[];
  };
  flags: FlagMap;
  day: {
    count: number;
    week_count: number;
    day_of_week: number;
    rested: boolean;
  };
  overnight_eval: {
    pending_notifications: string[];
    phase_check: boolean;
    npc_breakthrough_check: boolean;
  };
  quest_states: Record<string, QuestStatus>;
  unlocked_locations: string[];
  unlocked_shops: string[];
  session: {
    game_version: string;
    save_timestamp: string;
    playtime: number;
  };
}

// ── Full Game State (passed to evaluator) ─────────────────────

// Full NPC state (includes display info and location mapping)
export interface NPCState {
  id: string;
  name: string;
  locations: NPCLocation[];
  affection: { value: number; high_threshold: number };
  corruption: { value: number; high_threshold: number };
  traits: Record<string, {
    unlocked: boolean;
    current_tier: number;
    tiers: Array<{ value: number; cap: number }>;
  }>;
  daily_counters: Record<string, { current: number; max: number }>;
  flags: Record<string, ConditionValue>;
}

export interface PlayerState {
  stats: Record<string, {
    value: number;
    max: number;
    thresholds: StatThreshold[];
  }>;
  skills: Record<string, NPCTrait>;
  inventory: {
    consumables: Record<string, { quantity: number }>;
    key_items: Record<string, boolean>;
    gifts: Record<string, { quantity: number }>;
  };
  economy: PlayerEconomy;
  daily_counters: Record<string, { current: number; max: number }>;
  flags: Record<string, ConditionValue>;
}

export interface GameState {
  npcs: Record<string, NPCState>;
  player: PlayerState;
  global: GlobalState;
  items: Record<string, Item>;
  shops: Record<string, Shop>;
  quests: Record<string, Quest>;
}
