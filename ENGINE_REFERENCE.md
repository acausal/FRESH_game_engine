# FRESH Engine — Codebase Reference

Stat-gated state-machine engine. Conditions are the spine; everything else
(REST cycle, actions, events, dialogue, quests, save/load) reads or
writes GameState through the StateManager. Console-first: a REPL drives it.

---

## Condition Types

Inline conditions live in `conditions` arrays as `{ inline: { ... } }`
or bare `{ ... }`. The evaluator supports:

| Type | Shape | Notes |
|------|-------|-------|
| `player_stat` | `{ target_id, operator, value }` | stat name (intelligence/charisma/physique) |
| `npc_stat` | `{ target_id: "npc:stat", operator, value }` | stat ∈ affection/corruption |
| `npc_flag` | `{ target_id: "npc:flag", operator: "has", value: true }` | flag gate needs operator |
| `npc_trait` | `{ target_id: "npc:trait", operator, value }` | trait tier |
| `player_skill` | `{ target_id, operator, value }` | skill name |
| `player_flag` | `{ target_id, operator: "has", value: true }` | flag gate needs operator |
| `player_inventory` | `{ target_id: item_id }` | has-item check |
| `global_flag` | `{ target_id, operator: "has", value: true }` | **needs operator in REST/unlock path** (see Gotchas) |
| `day_count` | `{ operator, value }` | day number |
| `world_phase` | `{ operator, value }` | phase index |
| `quest_state` | `{ target_id, operator, value }` | active/completed/etc. |
| `location_unlocked` | `{ target_id }` | location id |

Operators: `gte, lte, gt, lt, eq, neq, has, not_has`.
`has`/`not_has` read a boolean flag; pass `value: true`.

---

## StateManager (mutate ONLY through this)

| Area | Methods |
|------|---------|
| Global flags | `setGlobalFlag(id, v)`, `setGlobalFlags(map)`, `getGlobalFlag(id)` |
| Player stats | `bumpPlayerStat(id, delta): StateChange[]` |
| Economy | `adjustBalance(delta): boolean` (false = insufficient), `payWeeklyIncome()` |
| Inventory | `addItemToInventory(id, type, qty?)`, `addKeyItem(id)`, `removeKeyItem(id)`, `grantItem(id, qty, type)` (type inferred from item registry; used by `item_grants`), `consumeItem(id, qty, type): boolean` (false = insufficient) |
| NPCs | `setNPCState(id, {affection, corruption, traits, flags})`, `getNPC(id)`, `getNPCFlag(id, flag)` |
| Locations | `setLocation(id)` (updates previous), `unlockLocation(id)`, `unlockShop(id)`, `isLocationUnlocked(id)` |
| Phase/Day | `advanceDay()`, `setRested()`, `clearRested()`, `advanceWorldPhase()`, `resetAllDailyCounters()` |
| Notifications | `queueNotification(text)`, `flushNotifications(): string[]` |

Never mutate `state` directly.

---

## Location JSON (`data/locations/<id>.json`)

```json
{
  "id": "local_bar", "name": "Local Bar",
  "parent_id": "downtown", "region": "urban", "children": [],
  "unlock": { "unlocked": true, "conditions": null },
  "availability": { "available": true, "conditions": null },
  "description": "Low light, worn vinyl stools...",
  "contents": {
    "npcs": [{ "npc_id": "tina", "conditions": null }],
    "shops": [], "quests": [], "actions": []
  },
  "random_events": [], "assets": { "image": null, "ambient_description": "" }
}
```

- `parent_id: null` = world-map root.
- `contents.npcs` drives which NPC interactions show at a location
  (NOT hardcoded into `description` — presence is dynamic at runtime).
- `unlock.conditions` are checked during the REST cycle (Step 3).

---

## Action JSON (`data/actions/<id>.json`)

```json
{
  "id": "action_id", "name": "Display Name",
  "action_type": "rest|job|location_action|npc_interaction",
  "context": { "type": "location|npc", "target_id": "loc|npc" },
  "visibility": { "conditions": [{ "inline": { "type": "npc_stat", "target_id": "alex:affection", "operator": "gte", "value": 30 } }] },
  "availability": {
    "caps": { "daily": { "enabled": true, "max": 1, "current": 0, "when_exhausted": "grey_out" },
            "lifetime": { "enabled": false, "max": null, "current": 0, "when_exhausted": "grey_out" } },
    "prerequisites": { "money": 20, "items": [{ "item_id": "key", "consumed_on_use": false }], "flags": null }
  },
  "effects": {
    "text": "Flavor text", "text_key": null, "scene_id": null,
    "stat_bumps": { "stat_id": "intelligence", "value": 1 },
    "npc_effects": { "npc_id": "alex", "affection": 2, "corruption": 1, "trait_bumps": null, "flags": { "met": true } },
    "money_delta": 10,
    "player_flags": { "flag": true },
    "global_emissions": [{ "flag": "vault_unlocked", "value": true }],
    "item_grants": [{ "item_id": "key", "quantity": 1 }],
    "item_consumes": null,
    "quest_triggers": null,
    "event_id": null, "event_probability": null
  },
  "assets": { "icon": null }
}
```

- `visibility` = shown at all? `availability` = can execute?
- **Money cost lives in `prerequisites.money`** (auto-spent on exec).
  Do NOT also set negative `money_delta` — that double-charges.
  Use `money_delta` only for gains (sell) / non-prereq costs.
- `item_grants` / `item_consumes` are arrays; type resolved from the item registry.
- `event_id` (+ `event_probability`) **chains into a follow-up event** (see Event Chaining).

### Execution flow
1. Visibility check → hidden if fail.
2. Availability: money ≥ prereq, items owned, daily cap not exhausted → else greyed.
3. Execute effects in order: stat bumps → npc changes → money delta →
   player flags → global emissions → item grants/consumes → quest triggers →
   **event trigger** (if `event_id` set).

---

## Dialogue (`data/dialogues/<id>.json`)

A graph of nodes for one NPC. Player picks responses; nodes can
auto-route to another node based on world state before showing choices.

```json
{
  "id": "tina_poc", "npc_id": "tina", "root_node_id": "greet",
  "nodes": {
    "greet": {
      "id": "greet", "text": "...", "speaker": "Tina",
      "routes": [{ "conditions": [{ "inline": { "type": "player_flag", "target_id": "knows_rumor", "operator": "has", "value": true } }], "target_node_id": "greet_knowing" }],
      "choices": [
        { "text": "Ask about the vault.", "prerequisites": null,
          "effects": { "text": null, "text_key": null, "scene_id": null, "stat_bumps": null,
            "npc_effects": null, "money_delta": null, "player_flags": { "met": true },
            "global_emissions": null, "item_grants": [{ "item_id": "key", "quantity": 1 }],
            "item_consumes": null, "quest_triggers": null, "event_id": "vault_event", "event_probability": 1 },
          "next_node_id": null }
      ]
    },
    "greet_knowing": { "id": "greet_knowing", "text": "...", "speaker": "Tina", "routes": null, "choices": [] }
  }
}
```

API (`dialogue.ts`):
- `enterNode(dialogue, nodeId, state, evaluator)` → `{ node, available_responses }`
  (resolves conditional `routes` first; first matching route wins).
- `resolveDialogueChoice(node, choiceIndex, stateManager, evaluator)` →
  applies the choice's `effects` (via a synthetic action, same path as events)
  and returns `next_node_id` (null = end conversation).

**Breadth/precedence:** a node may have many `routes` + choices; the
first condition-matching route redirects; choices are filtered by `prerequisites`.

---

## Events + Chaining (`data/events/<id>.json`)

```json
{ "id": "vault_event", "text": "A hidden passage responds.",
  "choices": [{ "text": "Step through.", "prerequisites": null,
    "effects": { "text": null, "text_key": null, "scene_id": null, "stat_bumps": null,
      "npc_effects": null, "money_delta": null, "player_flags": null,
      "global_emissions": [{ "flag": "vault_unlocked", "value": true }],
      "item_grants": null, "item_consumes": null, "quest_triggers": null,
      "event_id": null, "event_probability": null } }] }
```

API (`events.ts`):
- `loadEvent(events, id)`, `getEventWithAvailableChoices(events, id, state, evaluator)`,
  `resolveEventChoice(event, choiceIndex, stateManager, evaluator)`.
- **Chaining:** any `ActionEffects` (from an action, dialogue choice, or
  event choice) may carry `event_id` + `event_probability`.
  `evaluateActionEventTrigger(effects)` returns the chained event id (or null).
  `event_probability: 0` is valid (never fires) — resolved with `?? 1.0`,
  so 0 is respected, not treated as unset.

### Vertical-slice integration (proven by poc_branching_mystery)
`talk` → dialogue choice grants item + emits flag + sets `event_id`
→ event choice emits a global unlock flag
→ REST cycle reads `location.unlock.conditions` → unlocks the location.
All four systems compose through the StateManager.

---

## Quests (`data/quests` via `state.quests`)

`quest.ts` → `QuestManager`:
- `evaluateDuringRestCycle(stateManager, evaluator)` runs during REST:
  auto-starts quests whose `auto_start.conditions` pass, then advances
  stages whose `completion_conditions` are met.
- A quest = ordered `stages[]`; each stage has `completion_conditions`
  (null on the final stage = auto-completes once reached).
- **One stage resolves per REST cycle** — a 3-stage quest takes ≥3
  nights to fully complete (reaching final stage and completing it are
  separate cycles).
- `initiateQuest(id)`, `getQuestStatus(id)` for direct control.

---

## Random Events (`random_events.ts`)

`evaluateLocationEvents(randomEvents, eventTriggers, state, evaluator)`
→ `LocationEventResult { fired, resolution?, triggered_event_id? }`.
Each event: `{ event_id, conditions, probability, trigger: 'on_visit'|'on_action',
trigger_action_id, cooldown: { type, last_fired }, content: { text, rewards } }`.
`applyEventRewards(resolution, stateManager)` → `RewardResult`.
The `content.text` field is a **Tracery grammar key** (expands via `grammar.ts`);
a missing key returns a `((key))` fallback.

---

## Save / Load (`save.ts`)

- `saveGame(state, actions, savesDir, slot = "default")` → writes
  `{ version, saved_at, state, action_caps }` to `saves/<slot>.json`.
  `action_caps` is a sidecar snapshot of each action's daily/lifetime
  `current` counters (so caps restore exactly).
- `loadGame(slot, actions, savesDir)` → validates, re-applies `action_caps`
  onto the live `Action[]`, returns restored `GameState`.
- `listSaves(savesDir)` → available slots.
- Console: `save [slot]`, `load [slot]`, `saves`.

---

## Console Commands

| Cmd | Effect |
|-----|--------|
| `0E`, `1E`… | travel to exit by number (unlocked − current) |
| `0`, `1`… | execute action by number (location + NPC actions) |
| `talk <npc_id>` | start a dialogue (e.g. `talk tina`) |
| `status` | show player state |
| `rest` | force the REST cycle |
| `save [slot]` / `load [slot]` / `saves` | save management |
| `help` | command list |
| `quit` | exit |

---

## REST Cycle (`runRestCycle`)

Executes on rest. Order:
1. Guard — already rested today? abort.
2. World-phase advancement (conditions met?).
3. Location unlocking (`unlock.conditions`).
4. NPC breakthroughs (affection/corruption thresholds → trait advance).
5. Daily counter reset (all action caps → 0).
6. Day advance.
7. Weekly income (day % 7 == 0).
8. Notification flush.

Quests (`QuestManager.evaluateDuringRestCycle`) run inside this pass.

---

## Tracery (`grammar.ts`)

`expandText(key, state?)` expands a grammar rule; `getGrammar()` loads
`grammar/*.json` (actions.json, notifications.json). Used for state-aware
procedural flavor (event text, notifications, gossip). Missing key → `((key))`.

---

## Gotchas (real, surfaced by the POC suite)

1. **Money — pick ONE cost path per action.** `prerequisites.money` deducts
   if set (>0); `money_delta` deducts independently if negative. They are
   **additive, not a replacement** — setting BOTH non-zero on one action
   deducts both (double charge). Either path alone is fine; existing sample
   data using `money_delta`-only works as-is. Don't mix them.
2. **`event_probability: 0`** is valid (never fires); engine uses `?? 1.0`
   so 0 isn't swallowed. (The legacy `eventTriggers` fallback path
   still uses `|| 1.0` — `probability: 0` there is ignored. Use the
   primary `event_id` path.)
3. **Flag conditions need an `operator`** (`has`/`not_has` + `value: true`)
   in the REST/unlock evaluation path (`applyOperator(undefined)` throws
   otherwise). `global_flag`, `player_flag`, `npc_flag` all require it
   when checked via `runRestCycle` location-unlock.
4. **One quest stage per REST** — don't expect multi-stage completion
   in a single night.
5. **`consumeItem`** leaves a zero-qty entry behind (quirk, not a bug).
6. **NPC presence is dynamic** — never bake `contents.npcs` into a
   location `description`; the engine injects it at runtime.

---

## Verification

`npm run check` (tsc --noEmit) + `npm test` (170 tests across
evaluator/rest/actions/loader/events/dialogue/save). The 9 `poc_*.ts`
harnesses each drive the real engine end-to-end:
1. daily economy + REST cycle, 2. dialogue graph, 3. event chaining
(caught the `||`→`??` 0-bug), 4. NPC axes + trait tiers,
5. shop buy/sell + item-type inference, 6. random events + Tracery,
7. quest multi-stage, 8. branching vertical slice, 9. dialogue routing breadth.
