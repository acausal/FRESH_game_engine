// dsl.ts — compiler for the phone-friendly DSL (see DSL_REFERENCE.md).
// Parses plaintext content blocks and emits engine-loadable JSON
// (one entity per file, matching the loader's data/<type>/<id>.json layout).
//
// No external deps. Pure line-parser. Each category compiles to the
// exact shape in types.ts (verified against the engine).

import * as fs from 'fs';
import * as path from 'path';
import {
  NPC, NPCLocation, NPCTrait, ActionEffects, Location, LocationEventTrigger,
  Item, ItemType, Shop, ShopInventoryItem, Quest, QuestStage, Event, EventChoice,
  Dialogue, DialogueNode, DialogueChoice, DialogueRoute, ConditionReference,
  Action, ActionType, ActionPrerequisites,
} from './types';

// ── Tokenizing ────────────────────────────────────────────────

export type Category =
  | 'NPCS' | 'ACTIONS' | 'LOCATIONS' | 'ITEMS' | 'SHOPS'
  | 'GRAMMARS' | 'QUESTS' | 'EVENTS' | 'DIALOGUES';

export interface RawLine { indent: number; body: string; }
export interface RawBlock { title: string; lines: RawLine[]; }
export interface CategorySection { category: Category; blocks: RawBlock[]; }

export function parseSource(src: string): CategorySection[] {
  const sections: CategorySection[] = [];
  let current: CategorySection | null = null;
  let block: RawBlock | null = null;

  for (const raw of src.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const cat = line.match(/^=\s*([A-Z_]+)\s*$/);
    if (cat) {
      const name = cat[1] as Category;
      if (!isCategory(name)) throw new Error(`Unknown category: ${name}`);
      current = { category: name, blocks: [] };
      sections.push(current);
      block = null;
      continue;
    }
    if (!current) continue;
    if (line.trim() === '' || line.startsWith('//')) continue; // blank / scratch comment
    if (line.startsWith('#')) {
      const indent = line.match(/^#+/)![0].length;
      const body = line.slice(indent).replace(/^\s/, '');
      if (block) block.lines.push({ indent, body });
    } else {
      block = { title: line.trim(), lines: [] };
      current.blocks.push(block);
    }
  }
  return sections;
}

function isCategory(s: string): s is Category {
  return ['NPCS','ACTIONS','LOCATIONS','ITEMS','SHOPS','GRAMMARS','QUESTS','EVENTS','DIALOGUES'].includes(s);
}

// ── Slug + shared helpers ─────────────────────────────────────

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function l1(lines: RawLine[]): string[] { return lines.filter(l => l.indent === 1).map(l => l.body); }

function attr(lines: RawLine[], key: string): string | undefined {
  const p = l1(lines).find(l => l.match(new RegExp(`^${key}\\s*:`)));
  if (!p) return undefined;
  return p.slice(p.indexOf(':') + 1).trim();
}

// "# notes:" then following indent-2 "- ..." lines
function notesBlock(lines: RawLine[]): string[] | null {
  const idx = lines.findIndex(l => l.indent === 1 && l.body.trim() === 'notes:');
  if (idx === -1) return null;
  const out: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (lines[i].indent === 2) { const m = lines[i].body.match(/^-\s*(.+)$/); if (m) out.push(m[1].trim()); }
    else if (lines[i].indent <= 1) break;
  }
  return out.length ? out : null;
}

// ── Condition parsing (DSL → ConditionReference) ──────────────
export function parseCondition(c: string): ConditionReference {
  c = c.trim();
  const wrap = (type: any, target_id: string, operator: any, value: any): ConditionReference =>
    ({ inline: { type, target_id, operator, value } });

  let m = c.match(/^global_flag\s*=\s*(.+)$/);
  if (m) return wrap('global_flag', 'global_flag', 'has', coerce(m[1]));
  m = c.match(/^flag:\s*([\w]+)\s*=\s*(.+)$/);
  if (m) return wrap('npc_flag', m[1], 'has', coerce(m[2]));
  m = c.match(/^([\w]+):flag\(([\w]+)\)\s*=\s*(.+)$/);
  if (m) return wrap('npc_flag', `${m[1]}:${m[2]}`, 'has', coerce(m[3]));
  m = c.match(/^([\w]+):([\w]+)\s*=\s*(.+)$/);
  if (m) {
    const npc = m[1], field = m[2];
    const type = ['affection', 'corruption'].includes(field) ? 'npc_stat' : 'npc_flag';
    return wrap(type, `${npc}:${field}`, 'has', coerce(m[3]));
  }
  m = c.match(/^([\w:]+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
  if (m) {
    const target = m[1], op = m[2], raw = m[3], val = coerce(raw);
    // Bare "KEY = true/false" with no colon = a player flag, not a stat read.
    const type = (op === '=' || op === '!=') && typeof val === 'boolean'
      ? 'player_flag'
      : target === 'day_count' ? 'day_count'
      : target === 'world_phase' ? 'world_phase'
      : target.startsWith('quest_state') ? 'quest_state'
      : target.includes(':') ? 'npc_stat'
      : 'player_stat';
    const operator = op === '=' ? 'eq' : op === '!=' ? 'neq' : (op as any);
    return wrap(type, target, operator, val);
  }
  throw new Error(`Unparseable condition: "${c}"`);
}

function coerce(v: string): any {
  v = v.trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

// ── Effect parsing (shared vocabulary) ─────────────────────────
export function parseEffects(lines: string[]): ActionEffects {
  const fx: ActionEffects = {
    text: null, text_key: null, scene_id: null, stat_bumps: null, npc_effects: null,
    money_delta: null, player_flags: null, global_emissions: null, item_grants: null,
    item_consumes: null, quest_triggers: null, event_id: null, event_probability: null,
  };
  const l1s = lines;
  const t = attrFrom(l1s, 'text');
  if (t) fx.text = t;
  const md = attrFrom(l1s, 'money');
  if (md !== undefined) fx.money_delta = Number(md);
  const aff = l1s.find(l => /^affection:\s*\w+\s*[+-]/.test(l));
  const cor = l1s.find(l => /^corruption:\s*\w+\s*[+-]/.test(l));
  if (aff || cor) {
    const npc = (aff || cor)!.match(/^\w+:\s*(\w+)/)![1];
    fx.npc_effects = {
      npc_id: npc,
      affection: aff ? Number(aff.match(/[+-]\s*(\d+)/)![1]) * (aff.includes('-') ? -1 : 1) : null,
      corruption: cor ? Number(cor.match(/[+-]\s*(\d+)/)![1]) * (cor.includes('-') ? -1 : 1) : null,
      trait_bumps: null, flags: null,
    };
  }
  const stat = l1s.find(l => /^([a-z_]+):\s*[+-]\s*\d+$/.test(l) && !['affection','corruption','money'].includes(l.split(':')[0].trim()));
  if (stat) {
    const m = stat.match(/^([a-z_]+):\s*([+-])\s*(\d+)$/)!;
    fx.stat_bumps = { stat_id: m[1], value: Number(m[3]) * (m[2] === '-' ? -1 : 1) };
  }
  for (const l of l1s) {
    const pf = l.match(/^flag:\s*([\w]+)\s*=\s*(.+)$/);
    if (pf) { fx.player_flags = fx.player_flags || {}; fx.player_flags[pf[1]] = coerce(pf[2]); }
    const gf = l.match(/^global_flag:\s*([\w]+)\s*=\s*(.+)$/);
    if (gf) { fx.global_emissions = fx.global_emissions || []; fx.global_emissions.push({ flag: gf[1], value: coerce(gf[2]) }); }
  }
  const qs = l1s.filter(l => l.startsWith('quest_start:')).map(l => l.slice(l.indexOf(':') + 1).trim());
  if (qs.length) fx.quest_triggers = qs;
  const ev = l1s.find(l => l.startsWith('event:'));
  if (ev) {
    const m = ev.slice(ev.indexOf(':') + 1).trim().match(/^(\S+)\s*(\d+)%?$/);
    if (m) { fx.event_id = m[1]; fx.event_probability = m[2] ? Number(m[2]) / 100 : null; }
  }
  return fx;
}

function attrFrom(lines: string[], key: string): string | undefined {
  const p = lines.find(l => l.match(new RegExp(`^${key}\\s*:`)));
  if (!p) return undefined;
  return p.slice(p.indexOf(':') + 1).trim();
}

// ── Per-category compilers ────────────────────────────────────

function compileNPC(b: RawBlock): NPC {
  const locs = (attr(b.lines, 'location') || '').split(',').map(s => s.trim()).filter(Boolean);
  const traits = (attr(b.lines, 'trait') || '').split(',').map(s => s.trim()).filter(Boolean);
  const npc: NPC = {
    id: slug(b.title), name: b.title, description: attr(b.lines, 'desc') || '',
    locations: locs.map(l => ({ location_id: slug(l), conditions: null }) as NPCLocation),
    affection: { value: 0, high_threshold: 50 },
    corruption: { value: 0, high_threshold: 50 },
    traits: Object.fromEntries(traits.map(t => [t, {
      unlocked: false, unlock_conditions: [], current_tier: 0, tiers: [],
    } as NPCTrait])),
    daily_counters: {}, flags: {}, emits: [],
    assets: { portrait: '', scenes: {} },
  };
  const n = notesBlock(b.lines);
  if (n) (npc as any)._notes = n;
  return npc;
}

function compileLocation(b: RawBlock): Location {
  const region = attr(b.lines, 'region') || 'urban';
  const desc = attr(b.lines, 'Description') || attr(b.lines, 'desc') || '';
  const npcs = (attr(b.lines, 'npcs') || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(id => ({ npc_id: slug(id), conditions: null }));
  const acts = (attr(b.lines, 'actions') || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(id => ({ action_id: slug(id), conditions: null }));
  const parent = attr(b.lines, 'parent');
  const children = (attr(b.lines, 'children') || '').split(',').map(s => s.trim()).filter(Boolean).map(slug);
  const triggers: LocationEventTrigger[] = [];
  for (const l of l1(b.lines)) {
    const m = l.match(/^event:\s*(\S+)\s*(\d+)%?$/);
    if (m) triggers.push({ event_id: m[1], probability: m[2] ? Number(m[2]) / 100 : 1.0 });
  }
  const loc: Location = {
    id: slug(b.title), name: b.title, description: desc,
    parent_id: parent ? slug(parent) : null, region, children,
    unlock: { unlocked: true, conditions: null },
    availability: { available: true, conditions: null },
    contents: { npcs, shops: [], quests: [], actions: acts },
    random_events: [], event_triggers: triggers.length ? triggers : null,
    assets: { image: null, ambient_description: '' },
  };
  const n = notesBlock(b.lines);
  if (n) (loc as any)._notes = n;
  return loc;
}

function compileItem(b: RawBlock): Item {
  const type = (attr(b.lines, 'type') || 'consumable') as ItemType;
  const item: Item = {
    id: slug(b.title), name: b.title, description: attr(b.lines, 'Description') || attr(b.lines, 'desc') || '',
    item_type: type, tags: null, gift: null, consumable: null, key_item: null,
    assets: { image: null },
  };
  if (type === 'consumable') {
    const eff = attr(b.lines, 'effect');
    item.consumable = { effect: { stat_bumps: null, flavor_text: attr(b.lines, 'flavor') || null } };
    if (eff) {
      const m = eff.match(/([a-z_]+)\s*[+-]\s*(\d+)/);
      if (m) item.consumable.effect.stat_bumps = [{ stat_id: m[1], value: Number(m[2]) * (eff.includes('-') ? -1 : 1), temporary: true }];
    }
  } else if (type === 'gift') {
    item.gift = { mode: 'repeatable', one_time: null, repeatable: { daily_cap: null, lifetime_cap: null, lifetime_given: 0, npc_targets: [] } };
  } else {
    item.key_item = { quest_related: false, notes: null };
  }
  return item;
}

function compileAction(b: RawBlock): Action {
  const ctx = (attr(b.lines, 'context') || '').trim();
  const forcedLoc = attr(b.lines, 'type') === 'location';
  const action_type: ActionType = forcedLoc ? 'location_action' : 'npc_interaction';
  // money: positive = gain (fx.money_delta), negative = cost (prerequisites.money)
  const md = attr(b.lines, 'money');
  const fx = parseEffects(l1(b.lines));
  const prereq: ActionPrerequisites = { money: null, items: null, flags: null };
  if (md !== undefined) {
    const n = Number(md);
    if (n < 0) prereq.money = -n;       // cost gate
    else fx.money_delta = n;             // gain
  }
  const gate = attr(b.lines, 'gate');
  const act: Action = {
    id: slug(b.title), name: b.title, description: attr(b.lines, 'desc') || attr(b.lines, 'text') || '',
    action_type,
    context: { type: forcedLoc ? 'location' : 'npc', target_id: slug(ctx) },
    visibility: { conditions: gate ? [parseCondition(gate)] : null },
    availability: {
      caps: {
        daily: { enabled: true, max: 1, current: 0, when_exhausted: 'grey_out' },
        lifetime: { enabled: false, max: null, current: 0, when_exhausted: 'grey_out' },
      },
      prerequisites: prereq,
    },
    effects: fx,
    assets: { icon: null },
  };
  const n = notesBlock(b.lines);
  if (n) (act as any)._notes = n;
  return act;
}

function compileShop(b: RawBlock): Shop {
  const gate = attr(b.lines, 'gate');
  const inv: ShopInventoryItem[] = [];
  for (const l of l1(b.lines)) {
    const m = l.match(/^([\w_]+)\s*-\s*(\d+)\s*\((.+)\)$/);
    if (m) {
      const qty = m[3].trim() === 'unlimited' ? null : Number(m[3].trim());
      inv.push({ item_id: slug(m[1]), name: m[1], description: '', price: Number(m[2]),
        item_type: 'consumable' as ItemType, quantity: qty, conditions: null });
    }
  }
  return {
    id: slug(b.title), name: b.title, description: attr(b.lines, 'Description') || attr(b.lines, 'desc') || '',
    location_id: slug(attr(b.lines, 'location_id') || attr(b.lines, 'location') || ''),
    unlock: { unlocked: !gate, conditions: gate ? [parseCondition(gate)] : null },
    inventory: inv, assets: { shop_image: null, banner_image: null },
  };
}

// Quests/Events/Dialogues: section-based — block[0] = parent, rest = children.
function compileQuestSection(blocks: RawBlock[]): Quest {
  const meta = blocks[0];
  const start = attr(meta.lines, 'start');
  const stages: QuestStage[] = blocks.slice(1).map(b => {
    const complete = (attr(b.lines, 'complete') || '').split(' AND ').map(c => c.trim()).filter(Boolean).map(parseCondition);
    const fail = (attr(b.lines, 'fail') || '').split(' AND ').map(c => c.trim()).filter(Boolean).map(parseCondition);
    const ev = attr(b.lines, 'event');
    return {
      id: slug(b.title), description: attr(b.lines, 'desc') || '',
      completion_conditions: complete.length ? complete : null,
      on_complete: parseEffects(l1(b.lines)),
      on_complete_event_id: ev || null,
      fail_conditions: fail.length ? fail : null,
    } as QuestStage;
  });
  const reqAttr = attr(meta.lines, 'requires');
  const reqFlags = reqAttr ? reqAttr.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : [];
  const autoConditions = reqFlags.length
    ? reqFlags.map(f => ({ inline: { type: 'player_flag', target_id: f, operator: 'has', value: true } as any }))
    : (start && start !== 'manual' ? [parseCondition(start)] : null);
  return {
    id: slug(meta.title), name: meta.title, description: attr(meta.lines, 'Description') || attr(meta.lines, 'desc') || '',
    visibility: { conditions: null },
    auto_start: { conditions: autoConditions },
    stages,
  };
}

function compileEventSection(blocks: RawBlock[]): Event {
  const meta = blocks[0];
  const text = l1(meta.lines).find(l => l !== 'notes:') || '';
  const choices: EventChoice[] = blocks.slice(1).map(b => ({
    text: b.title, prerequisites: null, effects: parseEffects(l1(b.lines)),
  } as EventChoice));
  return { id: slug(meta.title), text, choices };
}

function compileDialogueSection(blocks: RawBlock[]): Dialogue {
  const meta = blocks[0];
  const m = meta.title.match(/^(.+?)\s*\(([\w]+)\)\s*$/);
  const npcId = m ? m[2] : slug(meta.title);
  const namePart = m ? m[1].trim() : meta.title;
  const root = attr(meta.lines, 'root') || 'greet';
  const nodes: Record<string, DialogueNode> = {};
  for (const nb of blocks.slice(1)) {
    const id = slug(nb.title);
    const routes: DialogueRoute[] = [];
    const rawChoices: { text: string; lines: string[] }[] = [];
    let curChoice: { text: string; lines: string[] } | null = null;
    for (const l of nb.lines) {
      if (l.indent === 1) {
        const r = l.body.match(/^route:\s*(.+?)\s*->\s*(\w+)$/);
        if (r) routes.push({ conditions: [parseCondition(r[1])], target_node_id: r[2] });
      } else if (l.indent === 2) {
        curChoice = { text: l.body.replace(/^-\s*/, ''), lines: [] };
        rawChoices.push(curChoice);
      } else if (l.indent === 3 && curChoice) {
        curChoice.lines.push(l.body);
      }
    }
    const builtChoices: DialogueChoice[] = rawChoices.map(c => {
      const gate = attrFrom(c.lines, 'gate');
      const jump = c.lines.find(x => x.startsWith('->'));
      const target = jump ? (jump.includes('end') ? null : jump.replace('->', '').trim()) : null;
      if (target && !blocks.slice(1).some(nb2 => slug(nb2.title) === target)) {
        throw new Error(`Dialogue ${meta.title}: choice jumps to missing node "${target}"`);
      }
      return { text: c.text, prerequisites: gate ? [parseCondition(gate)] : null,
        effects: parseEffects(c.lines), next_node_id: target } as DialogueChoice;
    });
    nodes[id] = {
      id, text: attr(nb.lines, 'text') || '', speaker: attr(nb.lines, 'speaker') || null,
      routes: routes.length ? routes : null, choices: builtChoices,
    } as DialogueNode;
  }
  return { id: slug(namePart), npc_id: npcId, root_node_id: root, nodes };
}

function compileGrammar(b: RawBlock): Record<string, string | string[]> {
  const variants = l1(b.lines);
  const rule: string | string[] = variants.length === 1 ? variants[0] : variants;
  return { [slug(b.title)]: rule };
}

// ── Top-level compile ─────────────────────────────────────────

export interface CompiledOutput {
  npcs: NPC[]; locations: Location[]; items: Item[]; shops: Shop[];
  actions: Action[]; quests: Quest[]; events: Event[]; dialogues: Dialogue[];
  grammars: Record<string, string | string[]>;
}

export function compileBlocks(sections: CategorySection[]): CompiledOutput {
  const out: CompiledOutput = {
    npcs: [], locations: [], items: [], shops: [], actions: [], quests: [], events: [], dialogues: [], grammars: {},
  };
  for (const s of sections) {
    switch (s.category) {
      case 'NPCS': out.npcs.push(...s.blocks.map(compileNPC)); break;
      case 'LOCATIONS': out.locations.push(...s.blocks.map(compileLocation)); break;
      case 'ACTIONS': out.actions.push(...s.blocks.map(compileAction)); break;
      case 'ITEMS': out.items.push(...s.blocks.map(compileItem)); break;
      case 'SHOPS': out.shops.push(...s.blocks.map(compileShop)); break;
      case 'QUESTS': out.quests.push(compileQuestSection(s.blocks)); break;
      case 'EVENTS': out.events.push(compileEventSection(s.blocks)); break;
      case 'DIALOGUES': out.dialogues.push(compileDialogueSection(s.blocks)); break;
      case 'GRAMMARS': for (const b of s.blocks) Object.assign(out.grammars, compileGrammar(b)); break;
      default: throw new Error(`Category ${s.category} not yet emitted`);
    }
  }
  return out;
}

export function emit(out: CompiledOutput, baseDir: string): string[] {
  const written: string[] = [];
  const write = (sub: string, id: string, obj: any) => {
    const dir = path.join(baseDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, `${id}.json`);
    fs.writeFileSync(fp, JSON.stringify(obj, null, 2), 'utf-8');
    written.push(fp);
  };
  out.npcs.forEach(n => write('npcs', n.id, n));
  out.locations.forEach(l => write('locations', l.id, l));
  out.items.forEach(i => write('items', i.id, i));
  out.shops.forEach(s => write('shops', s.id, s));
  out.actions.forEach(a => write('actions', a.id, a));
  out.quests.forEach(q => write('quests', q.id, q));
  out.events.forEach(e => write('events', e.id, e));
  out.dialogues.forEach(d => write('dialogues', d.id, d));
  for (const [name, variants] of Object.entries(out.grammars)) write('grammar', name, { [name]: variants });
  return written;
}
