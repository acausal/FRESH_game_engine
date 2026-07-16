# FRESH Engine

A **stat-gated state-machine game engine** for text-first games. The engine is
UI-agnostic: it exposes a plain state machine and data layer you can hook up to
HTML, a terminal REPL, or any other frontend you choose. This repo ships a console
REPL as a reference runtime; the engine itself has no UI assumptions.

---

## Features

- **Condition evaluator** — 11 condition types (`player_stat`, `player_skill`, `npc_stat`,
  `npc_flag`, `npc_trait`, `player_flag`, `player_inventory`, `global_flag`, `day_count`,
  `world_phase`, `quest_state`, `location_unlocked`) with operators `gte/lte/gt/lt/eq/neq/has/not_has`.
  AND/OR/NOT expression trees.
- **REST cycle** — an 8-step daily advance (world-phase, location unlocks, NPC breakthroughs,
  daily-counter reset, day advance, weekly income, notification flush) driven by `runRestCycle`.
- **Actions** — visibility/availability gating, daily + lifetime caps, money cost (via
  `prerequisites.money`) and item prerequisites; effects reuse the shared `ActionEffects` shape.
- **NPC axes** — affection/corruption (`NPCAxis`, `value`/`high_threshold`) + trait tiers that
  advance on breakthrough.
- **Dialogue** — node graphs with conditional `routes` (first-match-wins) and choices that apply
  `ActionEffects` (stat bumps, flags, items, quest triggers, event chaining) and jump between nodes.
- **Events + chaining** — choices/actions can fire a follow-up `event_id` at `event_probability`
  (0.0–1.0; `?? 1.0` so 0 is respected). One event's choice can chain to another.
- **Quests** — linear multi-stage lifecycle: `auto_start` on condition, per-stage
  `completion_conditions`, `on_complete` effects + `on_complete_event_id`, `fail_conditions`.
  One stage resolves per REST cycle.
- **Random events + Tracery** — location `event_triggers` and `RandomEvent` spawns with
  probabilities/cooldowns; procedural text via Tracery grammars (`grammar/*.json`).
- **Save / load** — named slots (`saves/<slot>.json`) + an `action_caps` sidecar so daily/lifetime
  counters restore exactly.
- **DSL compiler** — `dsl.ts` + `npm run compile` turn a plaintext authoring format into
  engine-loadable JSON across 8 categories (NPCs, Locations, Items, Shops, Actions, Quests,
  Events, Dialogues, Grammars). See `DSL_REFERENCE.md`.
- **Verified** — 9 POC harnesses drive the real engine end-to-end; `npm test` runs the unit
  suites (evaluator, rest, actions, loader, events, dialogue, save, quest, random) — **195 checks**.

---

## Quick start

```bash
npm install
npm run check      # tsc --noEmit
npm test           # 195 checks across 9 suites
npm start          # launches the console REPL
```

### Console commands
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

## Authoring content

Game content is **JSON in `data/<type>/<id>.json`** (one entity per file). The engine loads
NPCs, locations, items, shops, actions, quests, events, dialogues, and grammars from a `dataDir`.

For authoring, write the phone-friendly DSL instead (see `DSL_REFERENCE.md`) and compile:

```bash
npm run compile -- path/to/content.dsl path/to/data
```

That emits `data/npcs/*.json`, `data/actions/*.json`, `data/quests/*.json`, etc. — directly
loadable by the engine. A runnable example lives at `../FRESH_design/data_cast/sample.dsl`
(compile it to `../FRESH_design/data_cast/_compiled/` to inspect the emitted JSON).

This repo is the **engine only**. Game design docs and content live in a separate project that
consumes the engine (e.g. via `npm install github:acausal/FRESH_game_engine`).

---

## Architecture

| Module | Responsibility |
|--------|----------------|
| `types.ts` | all data shapes |
| `evaluator.ts` | the condition spine |
| `state.ts` | `StateManager` — mutate state ONLY through this |
| `actions.ts` | action execution, caps, money |
| `events.ts` | event resolution + chaining |
| `dialogue.ts` | node graph entry/choice resolution |
| `quest.ts` | `QuestManager` REST progression |
| `random_events.ts` | probability/cooldown spawns |
| `grammar.ts` | Tracery integration |
| `rest.ts` | the REST cycle |
| `save.ts` | save/load |
| `loader.ts` | JSON loading per entity |
| `dsl.ts` | DSL → JSON compiler |
| `console.ts` | REPL runtime |

---

## Roadmap (known deferred items)

These are deliberate gaps, documented rather than invented-around:

- **Quest branching** — `stages` is a flat linear array (no `next_stage_id` / outcome forks).
  Branch points are expressed at the *content* level: a dialogue/event choice emits a
  `global_flag`, and a separate quest's `auto_start.conditions` keys off it (multiple parallel
  linear quests = the branch). A first-class branch construct is a future engine feature.
- **Quest fail-effects** — a failed quest flips `failed: true`; `QuestStage` has no `on_fail`
  block. Revisit if content authoring proves a need.
- **Engine-only / UI-agnostic** — this edition ships a console REPL as a *reference*
  runtime only. The engine has no UI assumptions; hook it to HTML or any other frontend
  by consuming `types.ts` / `loader.ts` / `state.ts` directly. A web/headless runtime is
  a consumer of the engine, not part of it.

---

## License

MIT
