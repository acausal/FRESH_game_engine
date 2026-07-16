// ============================================================
// poc_shopkeeper.ts — Minigame POC #5 (throwaway)
// Validates: shop-style buy/sell via the real action system —
// money prerequisite gate, money_delta charge, item_grants landing
// in the correct inventory bucket (consumable vs key_item, per the
// earlier item-type-inference fix), and item_consumes removal.
// Drives REAL executeAction against in-memory state + item registry.
// Does NOT touch data/ fixtures. Run: npx ts-node poc_shopkeeper.ts
// ============================================================

import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import { executeAction } from './actions';
import { GameState, Action, Item } from './types';

// Item registry (state.items) — drives inferItemType resolution.
const items: Record<string, Item> = {
  apple: { id: 'apple', item_type: 'consumable', name: 'Apple', description: '', base_value: 5, consumable: null, key_item: null, gift: null } as unknown as Item,
  mysterious_key: { id: 'mysterious_key', item_type: 'key_item', name: 'Mysterious Key', description: '', base_value: 0, consumable: null, key_item: null, gift: null } as unknown as Item,
};

function buildState(balance: number): GameState {
  return {
    npcs: {},
    player: {
      stats: {}, skills: {}, inventory: { consumables: {}, key_items: {}, gifts: {} },
      economy: { balance, weekly_income: 0, income_upgrade_cost: 0, income_max: 0 },
      daily_counters: {}, flags: {},
    },
    global: {
      current_location_id: 'shop', previous_location_id: null,
      world_phase: { current: 1, phases: [] }, flags: {},
      day: { count: 1, week_count: 0, day_of_week: 1, rested: false },
      overnight_eval: { pending_notifications: [], phase_check: false, npc_breakthrough_check: false },
      quest_states: {}, unlocked_locations: [], unlocked_shops: [],
      session: { game_version: 'poc', save_timestamp: '', playtime: 0 },
    },
    items, shops: {}, quests: {},
  } as unknown as GameState;
}

// Buy: must have >=10 (prereq), pay 10 (money_delta), gain apple x1.
const buyApple: Action = {
  id: 'buy_apple', name: 'Buy Apple ($10)', description: '',
  action_type: 'location_action', context: { type: 'location', target_id: 'shop' },
  visibility: { conditions: [] },
  availability: {
    caps: { daily: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' }, lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' } },
    prerequisites: { money: 10, items: null, flags: null },
  },
  effects: {
    text: 'You buy an apple.', text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
    money_delta: null, player_flags: null, global_emissions: null,
    item_grants: [{ item_id: 'apple', quantity: 1 }], item_consumes: null,
    quest_triggers: null, event_id: null, event_probability: null,
  },
  assets: { icon: null },
} as unknown as Action;

// Sell: must own apple (prereq), remove it (item_consumes), gain $5.
const sellApple: Action = {
  id: 'sell_apple', name: 'Sell Apple ($5)', description: '',
  action_type: 'location_action', context: { type: 'location', target_id: 'shop' },
  visibility: { conditions: [] },
  availability: {
    caps: { daily: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' }, lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' } },
    prerequisites: { money: null, items: [{ item_id: 'apple', consumed_on_use: true }], flags: null },
  },
  effects: {
    text: 'You sell the apple.', text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
    money_delta: 5, player_flags: null, global_emissions: null,
    item_grants: null, item_consumes: [{ item_id: 'apple', quantity: 1 }],
    quest_triggers: null, event_id: null, event_probability: null,
  },
  assets: { icon: null },
} as unknown as Action;

// Buy key: grants a key_item (validates type inference into key_items bucket).
const buyKey: Action = {
  id: 'buy_key', name: 'Buy Mysterious Key ($20)', description: '',
  action_type: 'location_action', context: { type: 'location', target_id: 'shop' },
  visibility: { conditions: [] },
  availability: {
    caps: { daily: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' }, lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' } },
    prerequisites: { money: 20, items: null, flags: null },
  },
  effects: {
    text: 'You obtain a key.', text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
    money_delta: null, player_flags: null, global_emissions: null,
    item_grants: [{ item_id: 'mysterious_key', quantity: 1 }], item_consumes: null,
    quest_triggers: null, event_id: null, event_probability: null,
  },
  assets: { icon: null },
} as unknown as Action;

let pass = 0, fail = 0;
function check(label: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function run() {
  const ev = new ConditionEvaluator({ conditions: {} });

  console.log('\n--- Buy: money gate + charge + grant to consumables ---');
  {
    const sm = new StateManager(buildState(50));
    const r = executeAction(buyApple, sm, ev, undefined);
    check('buy succeeded', r.success);
    check('balance 50 -> 40', sm.getState().player.economy.balance === 40);
    check('apple in consumables x1', sm.getState().player.inventory.consumables['apple']?.quantity === 1);
  }

  console.log('\n--- Buy blocked when insufficient funds ---');
  {
    const sm = new StateManager(buildState(5));
    const r = executeAction(buyApple, sm, ev, undefined);
    check('buy refused (insufficient)', !r.success);
    check('balance unchanged (5)', sm.getState().player.economy.balance === 5);
    check('no apple granted', !('apple' in sm.getState().player.inventory.consumables));
  }

  console.log('\n--- Sell: consumes owned item, pays out ---');
  {
    const sm = new StateManager(buildState(40));
    executeAction(buyApple, sm, ev, undefined);          // +apple, -10
    const before = sm.getState().player.economy.balance; // 30
    const r = executeAction(sellApple, sm, ev, undefined);
    check('sell succeeded', r.success);
    check('balance 30 -> 35', sm.getState().player.economy.balance === before + 5);
    check('apple consumed (quantity 0, entry lingers)', sm.getState().player.inventory.consumables['apple']?.quantity === 0);
  }

  console.log('\n--- Sell blocked when item not owned ---');
  {
    const sm = new StateManager(buildState(40));
    const r = executeAction(sellApple, sm, ev, undefined);
    check('sell refused (no apple)', !r.success);
  }

  console.log('\n--- Key item lands in key_items bucket (type inference) ---');
  {
    const sm = new StateManager(buildState(50));
    const r = executeAction(buyKey, sm, ev, undefined);
    check('buy key succeeded', r.success);
    check('balance 50 -> 30', sm.getState().player.economy.balance === 30);
    check('key in key_items (boolean owned flag)', sm.getState().player.inventory.key_items['mysterious_key'] === true);
    check('key NOT in consumables', !('mysterious_key' in sm.getState().player.inventory.consumables));
  }

  console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

run();
