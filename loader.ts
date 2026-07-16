// ============================================================
// loader.ts — Data loader
// Reads JSON files from /data and assembles typed game state.
// All file I/O lives here. The engine never touches the filesystem.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

import {
  NPC,
  Player,
  Location,
  Quest,
  Shop,
  Item,
  Action,
  Event,
  Dialogue,
  ConditionLibrary,
  GameState,
  GlobalState,
  QuestStatus,
} from './types';

// ── Load Errors ───────────────────────────────────────────────
// Descriptive errors that tell you exactly what file and what
// went wrong rather than cryptic runtime crashes.

export class LoadError extends Error {
  constructor(file: string, message: string) {
    super(`[LoadError] ${file}: ${message}`);
    this.name = 'LoadError';
  }
}

// ── File Utilities ────────────────────────────────────────────

function readJSON<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new LoadError(filePath, 'File not found.');
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new LoadError(filePath, `Failed to parse JSON: ${err}`);
  }
}

// Read all JSON files in a directory, return as array
function readJSONDir<T>(dirPath: string): T[] {
  if (!fs.existsSync(dirPath)) {
    throw new LoadError(dirPath, 'Directory not found.');
  }
  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
  return files.map(f => readJSON<T>(path.join(dirPath, f)));
}

// ── Validators ────────────────────────────────────────────────
// Light validation — check required fields exist and have
// sensible values. Not exhaustive, but catches common mistakes.

function validateNPC(npc: NPC, filePath: string): void {
  if (!npc.id)   throw new LoadError(filePath, 'NPC missing required field: id');
  if (!npc.name) throw new LoadError(filePath, `NPC ${npc.id} missing required field: name`);
  if (npc.affection?.value === undefined) throw new LoadError(filePath, `NPC ${npc.id} missing affection.value`);
  if (npc.corruption?.value === undefined) throw new LoadError(filePath, `NPC ${npc.id} missing corruption.value`);
  if (!Array.isArray(npc.locations)) throw new LoadError(filePath, `NPC ${npc.id} missing locations array`);
  if (!Array.isArray(npc.emits)) throw new LoadError(filePath, `NPC ${npc.id} missing emits array`);
}

function validateLocation(loc: Location, filePath: string): void {
  if (!loc.id)   throw new LoadError(filePath, 'Location missing required field: id');
  if (!loc.name) throw new LoadError(filePath, `Location ${loc.id} missing required field: name`);
  if (!Array.isArray(loc.children)) throw new LoadError(filePath, `Location ${loc.id} missing children array`);
}

function validateQuest(quest: Quest, filePath: string): void {
  if (!quest.id)   throw new LoadError(filePath, 'Quest missing required field: id');
  if (!quest.name) throw new LoadError(filePath, `Quest ${quest.id} missing required field: name`);
  if (!Array.isArray(quest.stages)) throw new LoadError(filePath, `Quest ${quest.id} missing stages`);
}

function validateShop(shop: Shop, filePath: string): void {
  if (!shop.id)   throw new LoadError(filePath, 'Shop missing required field: id');
  if (!shop.name) throw new LoadError(filePath, `Shop ${shop.id} missing required field: name`);
  if (!shop.location_id) throw new LoadError(filePath, `Shop ${shop.id} missing location_id`);
  if (!Array.isArray(shop.inventory)) throw new LoadError(filePath, `Shop ${shop.id} missing inventory array`);
}

function validateItem(item: Item, filePath: string): void {
  if (!item.id)        throw new LoadError(filePath, 'Item missing required field: id');
  if (!item.name)      throw new LoadError(filePath, `Item ${item.id} missing required field: name`);
  if (!item.item_type) throw new LoadError(filePath, `Item ${item.id} missing item_type`);
}

function validateAction(action: Action, filePath: string): void {
  if (!action.id)          throw new LoadError(filePath, 'Action missing required field: id');
  if (!action.name)        throw new LoadError(filePath, `Action ${action.id} missing required field: name`);
  if (!action.action_type) throw new LoadError(filePath, `Action ${action.id} missing action_type`);
  if (!action.context)     throw new LoadError(filePath, `Action ${action.id} missing context`);
}

function validateEvent(event: Event, filePath: string): void {
  if (!event.id)   throw new LoadError(filePath, 'Event missing required field: id');
  if (!event.text) throw new LoadError(filePath, `Event ${event.id} missing required field: text`);
  if (!Array.isArray(event.choices)) throw new LoadError(filePath, `Event ${event.id} missing choices array`);
  if (event.choices.length === 0) throw new LoadError(filePath, `Event ${event.id} has no choices`);
  for (let i = 0; i < event.choices.length; i++) {
    const choice = event.choices[i];
    if (!choice.text) throw new LoadError(filePath, `Event ${event.id} choice ${i} missing text`);
    if (!choice.effects) throw new LoadError(filePath, `Event ${event.id} choice ${i} missing effects`);
  }
}

function validateDialogue(dialogue: Dialogue, filePath: string): void {
  if (!dialogue.id)           throw new LoadError(filePath, 'Dialogue missing required field: id');
  if (!dialogue.npc_id)       throw new LoadError(filePath, `Dialogue ${dialogue.id} missing required field: npc_id`);
  if (!dialogue.root_node_id) throw new LoadError(filePath, `Dialogue ${dialogue.id} missing required field: root_node_id`);
  if (!dialogue.nodes || typeof dialogue.nodes !== 'object') {
    throw new LoadError(filePath, `Dialogue ${dialogue.id} missing nodes map`);
  }
  if (!dialogue.nodes[dialogue.root_node_id]) {
    throw new LoadError(filePath, `Dialogue ${dialogue.id} root_node_id '${dialogue.root_node_id}' not found in nodes`);
  }
  for (const [nodeId, node] of Object.entries(dialogue.nodes)) {
    if (!node.text) throw new LoadError(filePath, `Dialogue ${dialogue.id} node '${nodeId}' missing text`);
    if (!Array.isArray(node.choices)) throw new LoadError(filePath, `Dialogue ${dialogue.id} node '${nodeId}' missing choices array`);
    for (let i = 0; i < node.choices.length; i++) {
      const choice = node.choices[i];
      if (!choice.text) throw new LoadError(filePath, `Dialogue ${dialogue.id} node '${nodeId}' choice ${i} missing text`);
      if (!choice.effects) throw new LoadError(filePath, `Dialogue ${dialogue.id} node '${nodeId}' choice ${i} missing effects`);
      if (choice.next_node_id && !dialogue.nodes[choice.next_node_id]) {
        throw new LoadError(filePath, `Dialogue ${dialogue.id} node '${nodeId}' choice ${i} next_node_id '${choice.next_node_id}' not found`);
      }
    }
    if (node.routes) {
      for (let i = 0; i < node.routes.length; i++) {
        const route = node.routes[i];
        if (!dialogue.nodes[route.target_node_id]) {
          throw new LoadError(filePath, `Dialogue ${dialogue.id} node '${nodeId}' route ${i} target_node_id '${route.target_node_id}' not found`);
        }
      }
    }
  }
}

// ── Entity Loaders ────────────────────────────────────────────

export function loadNPCs(dataDir: string): Record<string, NPC> {
  const dir = path.join(dataDir, 'npcs');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const npcs: Record<string, NPC> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const npc = readJSON<NPC>(filePath);
    validateNPC(npc, filePath);
    if (npcs[npc.id]) {
      throw new LoadError(filePath, `Duplicate NPC id: ${npc.id}`);
    }
    npcs[npc.id] = npc;
  }
  return npcs;
}

export function loadLocations(dataDir: string): Record<string, Location> {
  const dir = path.join(dataDir, 'locations');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const locations: Record<string, Location> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const loc = readJSON<Location>(filePath);
    validateLocation(loc, filePath);
    if (locations[loc.id]) {
      throw new LoadError(filePath, `Duplicate Location id: ${loc.id}`);
    }
    locations[loc.id] = loc;
  }
  return locations;
}

export function loadQuests(dataDir: string): Record<string, Quest> {
  const dir = path.join(dataDir, 'quests');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const quests: Record<string, Quest> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const quest = readJSON<Quest>(filePath);
    validateQuest(quest, filePath);
    if (quests[quest.id]) {
      throw new LoadError(filePath, `Duplicate Quest id: ${quest.id}`);
    }
    quests[quest.id] = quest;
  }
  return quests;
}

export function loadShops(dataDir: string): Record<string, Shop> {
  const dir = path.join(dataDir, 'shops');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const shops: Record<string, Shop> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const shop = readJSON<Shop>(filePath);
    validateShop(shop, filePath);
    if (shops[shop.id]) {
      throw new LoadError(filePath, `Duplicate Shop id: ${shop.id}`);
    }
    shops[shop.id] = shop;
  }
  return shops;
}

export function loadItems(dataDir: string): Record<string, Item> {
  const dir = path.join(dataDir, 'items');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const items: Record<string, Item> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const item = readJSON<Item>(filePath);
    validateItem(item, filePath);
    if (items[item.id]) {
      throw new LoadError(filePath, `Duplicate Item id: ${item.id}`);
    }
    items[item.id] = item;
  }
  return items;
}

export function loadActions(dataDir: string): Action[] {
  const dir = path.join(dataDir, 'actions');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const actionIds = new Set<string>();
  const actions: Action[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    // Actions files can be a single action or an array of actions
    const raw = readJSON<Action | Action[]>(filePath);
    const batch = Array.isArray(raw) ? raw : [raw];
    for (const action of batch) {
      validateAction(action, filePath);
      if (actionIds.has(action.id)) {
        throw new LoadError(filePath, `Duplicate Action id: ${action.id}`);
      }
      actionIds.add(action.id);
      actions.push(action);
    }
  }
  return actions;
}

export function loadEvents(dataDir: string): Record<string, Event> {
  const dir = path.join(dataDir, 'events');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const events: Record<string, Event> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const event = readJSON<Event>(filePath);
    validateEvent(event, filePath);
    if (events[event.id]) {
      throw new LoadError(filePath, `Duplicate Event id: ${event.id}`);
    }
    events[event.id] = event;
  }
  return events;
}

export function loadDialogues(dataDir: string): Record<string, Dialogue> {
  const dir = path.join(dataDir, 'dialogues');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];

  const dialogues: Record<string, Dialogue> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const dialogue = readJSON<Dialogue>(filePath);
    validateDialogue(dialogue, filePath);
    if (dialogues[dialogue.id]) {
      throw new LoadError(filePath, `Duplicate Dialogue id: ${dialogue.id}`);
    }
    dialogues[dialogue.id] = dialogue;
  }
  return dialogues;
}

export function loadConditionLibrary(dataDir: string): ConditionLibrary {
  const filePath = path.join(dataDir, 'conditions.json');
  if (!fs.existsSync(filePath)) {
    // Condition library is optional — return empty if not present
    return { conditions: {} };
  }
  return readJSON<ConditionLibrary>(filePath);
}

export function loadPlayer(dataDir: string): Player {
  const filePath = path.join(dataDir, 'player.json');
  if (!fs.existsSync(filePath)) {
    throw new LoadError(filePath, 'player.json not found. Required for new game initialization.');
  }
  const player = readJSON<Player>(filePath);
  if (!player.name && player.name !== '') {
    throw new LoadError(filePath, 'Player missing name field.');
  }
  return player;
}

// ── World Config ──────────────────────────────────────────────
// Loads top-level world configuration — phases, starting location, etc.

export interface WorldConfig {
  game_version: string;
  starting_location_id: string;
  world_phase: {
    current: number;
    phases: GlobalState['world_phase']['phases'];
  };
  initially_unlocked_locations: string[];
  initially_unlocked_shops: string[];
}

export function loadWorldConfig(dataDir: string): WorldConfig {
  const filePath = path.join(dataDir, 'world.json');
  if (!fs.existsSync(filePath)) {
    throw new LoadError(filePath, 'world.json not found. Required for game initialization.');
  }
  const config = readJSON<WorldConfig>(filePath);
  if (!config.starting_location_id) {
    throw new LoadError(filePath, 'world.json missing starting_location_id.');
  }
  if (!config.game_version) {
    throw new LoadError(filePath, 'world.json missing game_version.');
  }
  return config;
}

// ── Game State Assembly ───────────────────────────────────────
// Takes all loaded data and assembles it into a GameState
// the engine can work with.

export interface LoadedData {
  npcs: Record<string, NPC>;
  locations: Record<string, Location>;
  quests: Record<string, Quest>;
  shops: Record<string, Shop>;
  items: Record<string, Item>;
  actions: Action[];
  events: Record<string, Event>;
  dialogues: Record<string, Dialogue>;
  conditionLibrary: ConditionLibrary;
  player: Player;
  worldConfig: WorldConfig;
}

export function assembleNewGameState(data: LoadedData): GameState {
  const { npcs, quests, player, worldConfig } = data;

  // Build quest states index from loaded quests (all start unavailable)
  const quest_states: Record<string, QuestStatus> = {};
  for (const questId of Object.keys(quests)) {
    // Quests don't start until triggered by action
    quest_states[questId] = {
      quest_id: questId,
      current_stage_index: 0,
      started_at: { day: 0, phase: 0 },
      stage_started_at: { day: 0, phase: 0 },
      completed: false,
      failed: false,
    };
  }

  // Build NPC state entries from loaded NPCs
  // NPCState now includes name and locations for display and location mapping
  const npcStates: GameState['npcs'] = {};
  for (const [id, npc] of Object.entries(npcs)) {
    npcStates[id] = {
      id: npc.id,
      name: npc.name,
      locations: npc.locations,
      affection: { ...npc.affection },
      corruption: { ...npc.corruption },
      traits: Object.fromEntries(
        Object.entries(npc.traits).map(([traitId, trait]) => [
          traitId,
          {
            unlocked: trait.unlocked,
            current_tier: trait.current_tier,
            tiers: trait.tiers.map(t => ({ value: t.value, cap: t.cap })),
          }
        ])
      ),
      daily_counters: { ...npc.daily_counters },
      flags: { ...npc.flags },
    };
  }

  const global: GlobalState = {
    current_location_id: worldConfig.starting_location_id,
    previous_location_id: null,
    world_phase: {
      current: worldConfig.world_phase.current,
      phases: worldConfig.world_phase.phases,
    },
    flags: {},
    day: {
      count: 1,
      week_count: 0,
      day_of_week: 0,
      rested: false,
    },
    overnight_eval: {
      pending_notifications: [],
      phase_check: false,
      npc_breakthrough_check: false,
    },
    quest_states,
    unlocked_locations: [...worldConfig.initially_unlocked_locations],
    unlocked_shops: [...worldConfig.initially_unlocked_shops],
    session: {
      game_version: worldConfig.game_version,
      save_timestamp: new Date().toISOString(),
      playtime: 0,
    },
  };

  return {
    npcs: npcStates,
    player: {
      stats: player.stats,
      skills: { ...player.skills },
      inventory: {
        consumables: { ...player.inventory.consumables },
        key_items: { ...player.inventory.key_items },
        gifts: { ...player.inventory.gifts },
      },
      economy: { ...player.economy },
      daily_counters: { ...player.daily_counters },
      flags: { ...player.flags },
    },
    global,
    items: data.items,
    shops: data.shops,
    quests: data.quests,
  };
}

// ── Main Loader ───────────────────────────────────────────────
// Loads everything from a data directory and returns
// both the assembled game state and the raw loaded data
// (raw data is needed by systems like the rest cycle
//  that need full NPC objects, not just NPC state).

export interface GameData {
  state: GameState;
  npcs: Record<string, NPC>;
  locations: Record<string, Location>;
  quests: Record<string, Quest>;
  shops: Record<string, Shop>;
  items: Record<string, Item>;
  actions: Action[];
  events: Record<string, Event>;
  dialogues: Record<string, Dialogue>;
  conditionLibrary: ConditionLibrary;
}

export function loadGameData(dataDir: string): GameData {
  const loaded: LoadedData = {
    npcs:             loadNPCs(dataDir),
    locations:        loadLocations(dataDir),
    quests:           loadQuests(dataDir),
    shops:            loadShops(dataDir),
    items:            loadItems(dataDir),
    actions:          loadActions(dataDir),
    events:           loadEvents(dataDir),
    dialogues:        loadDialogues(dataDir),
    conditionLibrary: loadConditionLibrary(dataDir),
    player:           loadPlayer(dataDir),
    worldConfig:      loadWorldConfig(dataDir),
  };

  const state = assembleNewGameState(loaded);

  return {
    state,
    npcs:            loaded.npcs,
    locations:       loaded.locations,
    quests:          loaded.quests,
    shops:           loaded.shops,
    items:           loaded.items,
    actions:         loaded.actions,
    events:          loaded.events,
    dialogues:       loaded.dialogues,
    conditionLibrary: loaded.conditionLibrary,
  };
}
