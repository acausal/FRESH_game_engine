# DSL Reference — Phone-Based Content Authoring

Phone-friendly plaintext format for capturing game content ideas. Compiles to valid JSON via template system.

**Indent character:** `#` (not spaces or tabs)

**Scratch comments:** lines starting with `//` are discarded on compile — usable anywhere, in any category. See "Notes Across All Categories" below.

---

## NPCs

```
Name
# location(s)
# trait list
# notes: (optional)
```

**Example:**

```
Alex
# bar
# romance
# sneaky
# notes:
## - secret route with sara
## - escalates around day 20
## - tension with jordan
```

**On Compile:**
- id: derived from name
- affection/corruption: defaults (50 high_threshold)
- daily_counters: template defaults
- Trait structures: template generates, unlock conditions based on trait type
- flags, emits: template generates

**Desktop Refinement:**
- Unlock conditions for traits
- Custom thresholds
- Location-specific visibility

---

## Actions

```
Name
# context (npc_id or location_id)
# effects (stat_bumps, npc_effects, money, etc.)
# gate: (conditions, optional)
# text: (flavor text)
# event: (event_id, optional — see Events)
# notes: (optional)
```

**Example — NPC Interaction:**

```
Talk to Sara
# sara
# affection: +3
# text: You chat with Sara for a while. She seems glad for company.

notes:
## - changes dialogue on day 3+
```

**Example — Work Action:**

```
Work from Home
# home
# money: +10
# text: You work through your shift. Another day done.
```

**Example — Gated Action:**

```
Go Down a Dark Path
# alex
# gate: alex:affection >= 30
# affection: +5
# corruption: +10
# global_flag: alex_corrupted = true
# text: You follow Alex into something dark and exciting.
```

**Effect Keys:**
- `affection: ±N` (NPC stat)
- `corruption: ±N` (NPC stat)
- `[stat_name]: ±N` (player stat)
- `money: ±N` (positive = gain, negative = cost)
- `global_flag: key = value` (world state)
- `text: ` (what player sees)
- `quest_start: quest_id` (fires `quest_triggers`; repeatable — multiple lines append rather than overwrite)
- `event: event_id [N%]` (fires `event_id` + `event_probability`; omit `%` for guaranteed. Singular — only one `event:` line per action, unlike Locations below)

**On Compile:**
- id: from name
- action_type: inferred (npc vs location)
- Daily caps: template defaults (1–3)
- Boilerplate structure

**Desktop Refinement:**
- Complex visibility conditions
- Multiple outcomes/branching
- Scene references
- Item prerequisites

---

## Locations

```
Name
# region (optional)
# Description
# npcs: (optional)
# actions: (optional)
# event: (event_id [N%], optional, repeatable — see Events)
# children: (optional, for sub-locations)
# parent: (optional, if sub-location)
# notes: (optional)
```

**Example — Hub Location:**

```
The Bar
# urban
# A dimly lit establishment where questionable deals happen.
# npcs: alex
# actions: alex_chat, alex_corrupt
# event: stranger_at_bar 20%
# notes:
## - hub location for early game
```

`event:` is repeatable here (unlike on Actions) — each line becomes a `LocationEventTrigger` entry in `event_triggers[]`, file order preserved. "First-match-wins if multiple" per the engine, so put higher-priority events first. Omitting `%` defaults to 100% (guaranteed on entry).

**Example — Sub-Location:**

```
Bedroom
# residential
# parent: home
# Your private space.
# actions: meditate
```

**On Compile:**
- id: from name
- unlock/availability: defaults (unlocked, available)
- contents structure: auto-generated
- random_events: empty initially

**Desktop Refinement:**
- Unlock conditions (gated locations)
- Availability conditions (time/flag-based)
- Ambient descriptions
- Random event spawners

---

## Items

```
Name
# type (consumable | gift | key_item)
# Description
# [type-specific fields]
# notes: (optional)
```

**Consumable:**

```
Coffee
# consumable
# Strong black coffee. Wakes you right up.
# effect: intellect +1 (temporary)
# flavor: You sip the strong black coffee. It's bitter but invigorating.
```

**Gift:**

```
Expensive Gift
# gift
# A high-end present. Costs money to acquire.
# rarity: rare
# stackable: true
```

**Key Item:**

```
Mysterious Key
# key_item
# A key of unknown origin. Might unlock something.
# rarity: rare
# stackable: false
# notes:
## - opens the secret club
```

**On Compile:**
- id: from name
- assets: null
- Boilerplate structure

**Desktop Refinement:**
- Asset references (images)
- Tag system for gift targeting

---

## Shops

```
Name
# location_id
# Description
# [item - price (quantity)]
# gate: (conditions, optional)
# notes: (optional)
```

**Example — Always Available:**

```
The Tavern Shop
# bar
# A cozy tavern with various wares.
# 
# coffee - 5 (unlimited)
# energy_drink - 10 (unlimited)
# expensive_gift - 75 (unlimited)
```

**Example — Gated Shop:**

```
The Secret Market
# alley
# Underground market. Requires corruption milestone.
# gate: alex_corrupted = true
#
# mysterious_key - 100 (1)
# rare_item - 50 (unlimited)
```

**On Compile:**
- id: from name
- unlock: template defaults or gate conditions
- Inventory: parsed into item objects with prices

**Desktop Refinement:**
- Shop images/banners
- Item-level conditions (if needed)

---

## Grammars

Rule-based procedural text. Compiles to Tracery JSON.

```
rule_name
# Variant 1
# Variant 2
# Variant 3

nested_rule
# Text with #rule_name# reference.
# Another variant with #rule_name#.
```

**Example:**

```
work_feeling
# Another day done.
# The hours blur together.
# At least you got paid.

job_work
# You work through your shift. #work_feeling#.

exercise_verb
# You run
# You jog
# You sprint

park_jog
# #exercise_verb# around the park. #exercise_result#.

exercise_result
# You feel better for it.
# Your muscles burn pleasantly.
```

**Compiles to:**

```json
{
  "work_feeling": ["Another day done.", "The hours blur together.", "At least you got paid."],
  "job_work": "You work through your shift. #work_feeling#.",
  "exercise_verb": ["You run", "You jog", "You sprint"],
  "park_jog": "#exercise_verb# around the park. #exercise_result#.",
  "exercise_result": ["You feel better for it.", "Your muscles burn pleasantly."]
}
```

**Rules:**
- Single rule on its own line (no `#` prefix)
- Variants on following lines (with `#` prefix)
- Inline Tracery tags (`#rule_name#`) preserved
- Single variant = string; multiple variants = array

---

## Notes Across All Categories

- **notes:** metadata that survives compilation as `_notes` array in JSON — for context worth keeping once the data ships (design intent, cross-references to other content)
- **`//` scratch comments:** fully discarded on compile, never touch the output JSON. Usable on their own line anywhere in any file — mid-block, between blocks, wherever. For things with zero value after compilation: TODOs, "flesh out on desktop," tone reminders, half-formed ideas. Distinct from `notes:` — if it's worth keeping in the data, use `notes:`; if it's just for you right now, use `//`.
- **gate:** optional; can be any condition (stat check, flag, NPC relationship)
- **Blank lines:** separate logical sections, ignored on compile

**Example:**

```
Alex
# bar
# romance
// TODO: revisit trait list once corruption route is fleshed out
# sneaky
# notes:
## - secret route with sara
// tone reminder: keep early interactions awkward, not smooth
## - escalates around day 20
```

---

## Quests

Linear stage sequence. First block in the file is quest-level metadata; every block after that is a stage, in file order — no explicit index needed.

```
Name
# Description
# start: manual | <condition>
# notes: (optional)

stage_id
# desc: (stage description)
# complete: (condition, repeatable — ANDs together)
# fail: (condition, optional, repeatable — ANDs together)
# event: (event_id, optional — guaranteed on stage completion)
# [effect keys — same vocabulary as Actions: affection, corruption, money, global_flag, text]

stage_id
# desc: ...
# complete: ...
```

**Example:**

```
Get Close to Alex
# A slow-burn arc testing how far things go with Alex.
# start: manual
# notes:
## - triggered by "meet_alex" action's quest_start effect

first_meeting
# desc: Strike up a conversation with Alex at the bar.
# complete: alex:met_player = true
# affection: alex +5
# text: You two hit it off immediately.

earn_trust
# desc: Build enough trust for Alex to open up.
# complete: alex:affection >= 30
# fail: day_count >= 60
# affection: alex +10
# flag: alex_trusts_you = true
# event: alex_trust_scene

final_confrontation
# desc: Confront Alex about the secret.
# complete: alex:flag(secret_revealed) = true
# corruption: alex +15
# money: +50
# text: The truth comes out.
```

**Field Mapping:**

| DSL field | Compiles to |
|---|---|
| `start: manual` | `auto_start.conditions: null` (quest only starts via an action's `quest_start:` effect) |
| `start: <condition>` | `auto_start.conditions: [condition]` |
| bare `#` line under title | `description` |
| `notes:` | `_notes` |
| stage block name | `stage.id` |
| `desc:` | `stage.description` |
| `complete:` | `stage.completion_conditions[]` (AND) |
| `fail:` | `stage.fail_conditions[]` (AND) |
| `event:` | `stage.on_complete_event_id` |
| effect keys | `stage.on_complete` (`ActionEffects`, same as Actions) |

**On Compile:**
- id: from name
- visibility: template default (always visible once started)
- Stage order: file order

**Desktop Refinement:**
- OR / complex condition trees on `complete:` or `fail:` — engine supports `AND`/`OR`/`NOT` condition expressions; DSL only emits AND. Hand-edit the compiled JSON for anything more.
- `visibility.conditions` (quest log visibility before start)

**Known limits (not DSL gaps — engine gaps):**
- No fail-state effects. `QuestStage` doesn't have an `on_fail` block — failing a quest just flips `failed: true`. Not adding DSL syntax the engine can't consume; revisit if content authoring proves a need (same call as managed stats).
- No branching. `stages: QuestStage[]` is a flat linear array — no `next_stage_id` or outcome-based branch pointers exist in the type, even though the original design doc calls for "optional simple branches." This needs its own engine design pass before any DSL branch syntax makes sense.

---

## Events

Player-facing branch points. Pure content — no trigger info lives on the event itself; triggers are wired from the *source* (Location, Action, or Quest — see their `event:` fields above). First block in the file is the event body; every block after that is a choice, in file order.

```
Name
# Event body text shown to the player.
# notes: (optional)

Choice text shown to player
# gate: (condition, optional, repeatable — ANDs together)
# [effect keys — same vocabulary as Actions/Quests]

Choice text shown to player
# gate: ...
# [effect keys]
```

**Example:**

```
A Stranger at the Bar
# A figure in a dark coat catches your eye from across the room.
# notes:
## - triggered from bar location, 20% chance

Approach them
# affection: alex +2
# event: stranger_followup 40%
# text: You strike up a conversation. They seem intrigued.

Ignore them and keep drinking
# text: You mind your own business. Probably for the best.

Ask Alex about them
# gate: alex:met_player = true
# flag: knows_stranger = true
# quest_start: stranger_mystery
# text: Alex's face goes pale. "You shouldn't have seen that."
```

`event:` on a choice chains to a follow-up event — same `event: event_id [N%]` syntax as Actions (see above), inherited automatically since choices compile to `ActionEffects`. No new field needed; this was previously undocumented by example, now is.

**Field Mapping:**

| DSL field | Compiles to |
|---|---|
| title line | `id` (slug — `Event` has no `name` field, title is authoring-only, discarded after compile) |
| bare `#` line under title | `text` (event body) |
| `notes:` | `_notes` |
| choice block title | `choice.text` |
| `gate:` | `choice.prerequisites[]` (AND) |
| effect keys (incl. `event:` for chaining) | `choice.effects` (`ActionEffects`, identical vocabulary to Actions/Quests) |

**On Compile:**
- id: from title
- choices: file order preserved

**Desktop Refinement:**
- OR / complex prerequisite trees on `gate:` (same AND-only limitation as Quests)
- Multi-line event body — phone DSL keeps the body to a single line; longer scene text belongs in a `scene_id` reference instead, not stuffed into the event body

---

## Dialogue

Graph of nodes belonging to one NPC. Unlike Quests/Events, node order in the file doesn't determine flow — choices and routes jump to nodes by id, so file order is just for readability. First block is dialogue-level metadata; every block after that is a node.

Choices support full `ActionEffects` (same vocabulary as Actions/Quests/Events) — the engine deliberately reuses the action system so dialogue gets stat bumps, flags, items, and quest triggers for free. This is intentional, not a restriction to design around. The **light template** below is the common case (pure narrative, one flag write); use the **full example** when a choice needs to actually move state.

```
Name (npc_id)
# root: node_id
# notes: (optional)

node_id
# text: (what the NPC says)
# speaker: (optional — display name override, blank = NPC)
# route: <condition> -> target_node_id (optional, repeatable — first match wins, file order)

## Choice text shown to player
### gate: (condition, optional, repeatable — ANDs)
### -> target_node_id | end
### [effect keys — same vocabulary as Actions/Quests/Events]

node_id
# text: ...
```

**Light Template (narrative-only):**

```
Sara Small Talk (sara)
# root: greeting

greeting
# text: Sara glances up and smiles.

## Ask how she's doing
### -> doing_well

## Just say hi
### -> end

doing_well
# text: "Pretty good, actually. Thanks for asking."
# flag: sara_asked_about_day = true

## Nice
### -> end
```

**Full Example (routing + effects):**

```
Alex Bar Chat (alex)
# root: greeting
# notes:
## - corrupted route unlocks after alex_corrupted flag

greeting
# text: Alex looks up as you approach.
# route: alex:corruption >= 50 -> dark_greeting

## Say hi
### -> small_talk

## Ask about the stranger
### gate: knows_stranger = true
### -> stranger_topic

## Leave
### -> end

dark_greeting
# text: Alex smirks, something different in their eyes tonight.
# speaker: Alex (Corrupted)

## Play along
### affection: alex +3
### corruption: alex +5
### event: alex_reveals_secret 100%
### -> small_talk

## Back away
### -> end

small_talk
# text: You two chat for a while.

## Wrap it up
### -> end
```

`event:` on a choice chains to a follow-up event — same syntax as Actions/Events (`event: event_id [N%]`), inherited automatically since choices compile to `ActionEffects`. A dialogue choice can fire an event and advance to a node in the same turn; the two are independent (event chaining doesn't consume the `-> node_id` jump, and vice versa).

**Field Mapping:**

| DSL field | Compiles to |
|---|---|
| title line `Name (npc_id)` | `id` (slug from name, discarded after compile), `npc_id` from parenthetical |
| `root:` | `root_node_id` |
| node block title | `node.id` |
| `text:` | `node.text` |
| `speaker:` | `node.speaker` (optional, null = NPC default) |
| `route: <condition> -> node_id` | `node.routes[]`, repeatable — first-match-wins in file order, matching the engine's own resolution rule |
| `##` choice title | `choice.text` |
| `### gate:` | `choice.prerequisites[]` (AND) |
| `### -> node_id` / `### -> end` | `choice.next_node_id` (`end` compiles to `null`) |
| `###` effect keys | `choice.effects` (`ActionEffects`, identical vocabulary to Actions/Quests/Events) |

**On Compile:**
- id: from title
- Node/choice validation: every `->` target must resolve to a node id that exists in the file (or `end`) — compiler should error on dangling references, not silently drop them

**Desktop Refinement:**
- OR / complex condition trees on `gate:` or `route:` (same AND-only limitation as everywhere else)
- Cross-file node references (a choice jumping into a different dialogue's node) — not supported; each `Dialogue` is a self-contained graph per the type

---

## Deferred

- Quest branching (engine gap — see Known limits above)
- Additional **Tracery** integration (randomized rewards, state-aware text)

