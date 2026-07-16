# Game Engine Codebase Reference

## Condition Types & Field Names

The evaluator supports these condition types. Format: inline conditions go in `conditions` arrays.

### player_stat
Check player stat value.
```json
{ "type": "player_stat", "target_id": "intelligence", "operator": "gte", "value": 2 }
```
- `target_id`: stat name (intelligence, charisma, physique)
- `operator`: gte, lte, gt, lt, eq, neq, has, not_has
- `value`: numeric threshold

### npc_stat
Check NPC affection or corruption.
```json
{ "type": "npc_stat", "target_id": "alex:affection", "operator": "gte", "value": 30 }
```
- `target_id`: `npc_id:stat_name` (must include colon)
- Valid stat names: affection, corruption
- `operator`: gte, lte, gt, lt, eq, neq, has, not_has

### npc_flag
Check an NPC-specific flag.
```json
{ "type": "npc_flag", "target_id": "alex:met_player" }
```
- `target_id`: `npc_id:flag_id` (must include colon)

### npc_trait
Check NPC trait tier.
```json
{ "type": "npc_trait", "target_id": "alex:deviousness", "operator": "gte", "value": 1 }
```
- `target_id`: `npc_id:trait_id` (must include colon)

### player_skill
Check player skill unlock/tier.
```json
{ "type": "player_skill", "target_id": "persuasion", "operator": "gte", "value": 1 }
```
- `target_id`: skill name

### player_flag
Check player-level flag.
```json
{ "type": "player_flag", "target_id": "flag_name" }
```
- `target_id`: flag name

### player_inventory
Check if player has item.
```json
{ "type": "player_inventory", "target_id": "mysterious_key" }
```
- `target_id`: item id

### global_flag
Check world-level flag.
```json
{ "type": "global_flag", "target_id": "alex_corrupted" }
```
- `target_id`: flag name
- No operator needed for has check

### day_count
Check current day number.
```json
{ "type": "day_count", "operator": "gte", "value": 5 }
```
- `operator`: gte, lte, gt, lt, eq
- `value`: day number

### world_phase
Check world phase.
```json
{ "type": "world_phase", "operator": "gte", "value": 2 }
```

### quest_state
Check quest status.
```json
{ "type": "quest_state", "target_id": "quest_id", "operator": "eq", "value": "active" }
```

### location_unlocked
Check if location is unlocked.
```json
{ "type": "location_unlocked", "target_id": "secret_club" }
```

---

## StateManager Methods

All state mutations go through StateManager. Never mutate state directly.

### Global Flags
```typescript
setGlobalFlag(flag_id: string, value: ConditionValue): void
setGlobalFlags(flags: Record<string, ConditionValue>): void
getGlobalFlag(flag_id: string): ConditionValue
```

### Player Stats
```typescript
bumpPlayerStat(stat_id: string, delta: number): StateChange[]
```

### Economy
```typescript
adjustBalance(delta: number): boolean  // Returns false if insufficient funds
payWeeklyIncome(): void
```

### Inventory
```typescript
addItemToInventory(item_id: string, item_type: 'consumable' | 'gift', quantity?: number): void
addKeyItem(item_id: string): void
removeKeyItem(item_id: string): void
consumeItem(item_id: string, item_type: 'consumable' | 'gift'): boolean
```

### NPC State
```typescript
setNPCState(npc_id: string, affection?: number, corruption?: number, traits?: any, flags?: any): void
getNPC(npc_id: string): NPC
getNPCFlag(npc_id: string, flag_id: string): ConditionValue
```

### Location Management
```typescript
setLocation(location_id: string): void  // Sets current location, updates previous
unlockLocation(location_id: string): void
isLocationUnlocked(location_id: string): boolean
```

### Daily/Phase Management
```typescript
advanceDay(): void
setRested(): void
clearRested(): void
advanceWorldPhase(): void
resetAllDailyCounters(): void
```

### Notifications
```typescript
queueNotification(text: string): void
flushNotifications(): string[]
```

---

## Location JSON Structure

```json
{
  "id": "location_id",
  "name": "Display Name",
  "description": "Long description",
  "parent_id": null,  // For sub-locations (e.g., bedroom under home)
  "region": "residential|urban|outdoor",
  "children": [],  // Sub-location IDs, NOT NPC IDs
  "unlock": {
    "unlocked": true|false,
    "conditions": [
      { "inline": { /* condition */ } }
    ]
  },
  "availability": {
    "available": true,
    "conditions": null
  },
  "contents": {
    "npcs": ["npc_id1", "npc_id2"],  // NPCs present at this location
    "shops": ["shop_id"],
    "quests": [],
    "actions": ["action_id1", "action_id2"]
  },
  "random_events": [],
  "assets": {
    "image": null,
    "ambient_description": "Atmospheric text"
  }
}
```

**Key Point:** `contents.npcs` tells the console which NPC interactions to show at a location.

---

## Action JSON Structure

```json
{
  "id": "action_id",
  "name": "Display Name",
  "description": "Short description",
  "action_type": "rest|job|location_action|npc_interaction",
  "context": {
    "type": "location|npc",
    "target_id": "location_id|npc_id"
  },
  "visibility": {
    "conditions": [
      { "inline": { /* condition */ } }
    ]
  },
  "availability": {
    "caps": {
      "daily": { "enabled": true, "max": 1, "current": 0, "when_exhausted": "grey_out" },
      "lifetime": { "enabled": false, "max": null, "current": 0, "when_exhausted": "grey_out" }
    },
    "prerequisites": {
      "money": 20,  // null or number
      "items": { "item_id": true },  // null or object
      "flags": null  // Rarely used
    }
  },
  "effects": {
    "text": "Action flavor text",
    "scene_id": null,
    "stat_bumps": { "stat_id": "intelligence", "value": 1 },  // null or object
    "npc_effects": {
      "npc_id": "alex",
      "affection": 2,  // null or number
      "corruption": 1,  // null or number
      "trait_bumps": null,
      "flags": { "met_player": true }  // null or object
    },
    "money_delta": 10,  // null or number (negative = cost)
    "player_flags": { "flag_name": true },  // null or object
    "global_emissions": null,
    "quest_triggers": null
  },
  "assets": { "icon": null }
}
```

**Context Types:**
- `"type": "location"` → appears at that location (visible if location has action in contents.actions)
- `"type": "npc"` → appears when at location with that NPC (location.contents.npcs includes npc_id)

**Visibility vs Availability:**
- **Visibility**: Condition determines if action is shown at all
- **Availability**: If visible, prerequisite determines if it can be executed

---

## Console Command Structure

### Navigation
- `0E`, `1E`, etc. → Travel to exit by number
- Exits shown are from `unlocked_locations` minus current location

### Actions
- `0`, `1`, etc. → Execute action by number
- Actions shown are location actions + NPC actions for NPCs at current location

### Special Commands
- `status` → Show player state
- `rest` → Force rest action
- `help` → Show command list
- `quit` → Exit game

---

## Rest Cycle Flow

Executes when player takes rest action. Steps in order:

1. **Guard Check**: Ensure not already rested today
2. **Phase Advancement**: Check if world phase conditions met
3. **Location Unlocking**: Evaluate location.unlock.conditions
4. **NPC Breakthroughs**: Check affection/corruption thresholds and trait advancement
5. **Daily Counter Reset**: Set all action caps to 0
6. **Day Advancement**: Increment day count
7. **Weekly Income**: Pay if day % 7 == 0
8. **Notification Flush**: Queue morning messages

---

## Action Execution Flow

1. **Visibility Check**: Does condition pass?
   - If no → action not shown
   - If yes → continue
2. **Availability Check**: Do prerequisites pass?
   - Money sufficient?
   - Items owned?
   - Daily cap not exhausted?
   - If any fail → action shown as grey (unavailable)
3. **Execute**: Apply all effects in order
   - Stat bumps
   - NPC changes (affection, corruption, flags)
   - Money delta
   - Player flags
   - Global emissions

---

## Common Patterns

### Affection-Gated Action
Visible when NPC affection >= threshold.
```json
"visibility": {
  "conditions": [
    { "inline": { "type": "npc_stat", "target_id": "alex:affection", "operator": "gte", "value": 30 } }
  ]
}
```

### Stat-Gated Action
Visible when player stat >= threshold.
```json
"visibility": {
  "conditions": [
    { "inline": { "type": "player_stat", "target_id": "intelligence", "operator": "gte", "value": 2 } }
  ]
}
```

### Money-Gated Action
Available (but visible) when player has enough money.
```json
"availability": {
  "prerequisites": { "money": 50, "items": null, "flags": null }
}
```

### Day-Based Location Unlock
Location unlocks on specific day.
```json
"unlock": {
  "unlocked": false,
  "conditions": [
    { "inline": { "type": "day_count", "operator": "gte", "value": 5 } }
  ]
}
```

### Flag-Based Location Unlock
Location unlocks when flag is set.
```json
"unlock": {
  "unlocked": false,
  "conditions": [
    { "inline": { "type": "global_flag", "target_id": "alex_corrupted" } }
  ]
}
```

---

## Important Notes

- **Always use `target_id:stat_name` format** for npc_stat (e.g., `"alex:affection"`, not separate fields)
- **NPC actions show at locations** based on `location.contents.npcs` array, not `children`
- **`children` array** in locations is for parent-child location relationships, NOT NPCs
- **Condition field names matter**: `target_id` not `stat_id`, `flag_id`, etc.
- **State mutations only through StateManager** - never mutate state object directly
- **Action caps are in Action objects**, not in state - they reset in console after rest succeeds
- **Location unlock conditions are checked during rest cycle** (Step 3)

