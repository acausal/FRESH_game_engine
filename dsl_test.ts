// dsl_test.ts — POC #10 (throwaway) for the DSL compiler.
// Validates: every category compiles to engine-loadable JSON and
// round-trips through the REAL engine loaders. Run: npx ts-node dsl_test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseSource, compileBlocks, emit, slug } from './dsl';
import { loadNPCs, loadLocations, loadQuests, loadEvents, loadDialogues, loadActions } from './loader';

const SAMPLE = `
= NPCS
Tina
# location: local_bar
# trait: romance, gossip
# desc: Bar regular. Talks too much, knows the town.
# notes:
## - complicit POV hook

Trevor
# location: park
# desc: Park regular. Watches the town.

= LOCATIONS
Local Bar
# urban
# A dim low-lit bar where the town loosens up.
# npcs: tina
# event: tina_gossip 20%

Park
# outdoor
# patchy grass, a bench, the whole town in view

= ITEMS
Coffee
# consumable
# Strong black coffee. Wakes you right up.
# effect: intellect +1 (temporary)
# flavor: You sip the strong black coffee.

= SHOPS
The Tavern Shop
# local_bar
# A cozy tavern with wares.
#
# coffee - 5 (unlimited)

= QUESTS
Get Close to Tina
# A slow-burn arc with Tina at the bar.
# start: manual
# notes:
## - triggered by tina_talk action's quest_start

first_meeting
# desc: Strike up a conversation with Tina.
# complete: tina:met_player = true
# affection: tina +5
# text: You two hit it off.

trust
# desc: Build trust.
# complete: tina:affection >= 30
# corruption: tina +5
# global_flag: tina_trusts = true
# event: tina_trust_scene

= EVENTS
A Stranger at the Bar
# A figure in a dark coat catches your eye.
# notes:
## - triggered from bar, 20%

Approach them
# affection: tina +2
# event: stranger_followup 40%
# text: You strike up a conversation.

Ignore them
# text: You mind your own business.

= DIALOGUES
Tina Bar Chat (tina)
# root: greeting

greeting
# text: Tina looks up as you approach.
# route: tina:corruption >= 50 -> dark_greeting

## Say hi
### -> small_talk

## Leave
### -> end

dark_greeting
# text: Tina smirks.

## Play along
### affection: tina +3
### -> small_talk

small_talk
# text: You two chat.

## Wrap it up
### -> end

= GRAMMARS
bar_mood
# Another night at the bar.
# The regulars are restless.
# #tina_line# cuts through the noise.

tina_line
# "You're new, right?"
# "Order me one and I'll talk."

bar_cheer
# The bar hums with easy laughter.

= ACTIONS
Talk to Tina
# tina
# affection: tina +3
# text: You chat with Tina for a while. She seems glad for company.
# notes:
## - changes dialogue on day 3+

Work from Home
# home
# type: location
# money: +10
# text: You work through your shift. Another day done.

Go Down a Dark Path
# alex
# gate: alex:affection >= 30
# affection: alex +5
# corruption: alex +10
# global_flag: alex_corrupted = true
# money: -20
# text: You follow Alex into something dark and exciting.
`;

function check(name: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`);
  if (!cond) process.exitCode = 1;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl_'));
const sections = parseSource(SAMPLE);
const out = compileBlocks(sections);
const written = emit(out, tmp);
check('emitted files', written.length > 0);

// Round-trip through REAL engine loaders
const npcs = loadNPCs(tmp);
check('npcs load (tina/trevor)', npcs['tina']?.name === 'Tina' && npcs['trevor']?.name === 'Trevor');
const locs = loadLocations(tmp);
check('locations load + contents.npcs', locs['local_bar']?.contents.npcs.some(n => n.npc_id === 'tina'));
check('location event_trigger parsed', locs['local_bar']?.event_triggers?.[0]?.event_id === 'tina_gossip' && locs['local_bar']?.event_triggers?.[0]?.probability === 0.2);
const quests = loadQuests(tmp);
check('quest loads + 2 stages', quests['get_close_to_tina']?.stages.length === 2);
check('quest stage on_complete event', quests['get_close_to_tina']?.stages[1]?.on_complete_event_id === 'tina_trust_scene');
check('quest auto_start manual = null', quests['get_close_to_tina']?.auto_start.conditions === null);
const events = loadEvents(tmp);
check('event loads + choice chain', events['a_stranger_at_the_bar']?.choices[0]?.effects?.event_id === 'stranger_followup');
check('event choice event_probability', events['a_stranger_at_the_bar']?.choices[0]?.effects?.event_probability === 0.4);
const dlg = loadDialogues(tmp);
check('dialogue npc_id parsed', dlg['tina_bar_chat']?.npc_id === 'tina');
check('dialogue id = name slug (no npc_id)', dlg['tina_bar_chat']?.id === 'tina_bar_chat');
check('dialogue route compiled', dlg['tina_bar_chat']?.nodes['greeting']?.routes?.[0]?.target_node_id === 'dark_greeting');
check('dialogue choice next_node', dlg['tina_bar_chat']?.nodes['greeting']?.choices[0]?.next_node_id === 'small_talk');
const actsArr = loadActions(tmp);
const acts = Object.fromEntries(actsArr.map(a => [a.id, a]));
check('actions load (npc + location + gated)', acts['talk_to_tina']?.action_type === 'npc_interaction' && acts['work_from_home']?.action_type === 'location_action' && acts['go_down_a_dark_path']?.availability.prerequisites.money === 20);
check('gated action visibility condition', (acts['go_down_a_dark_path']?.visibility.conditions?.[0] as any)?.inline?.type === 'npc_stat');
check('gain action money_delta', acts['work_from_home']?.effects.money_delta === 10);
// grammar is plain JSON, read directly
const barMood = JSON.parse(fs.readFileSync(path.join(tmp, 'grammar', 'bar_mood.json'), 'utf-8'));
const tinaLine = JSON.parse(fs.readFileSync(path.join(tmp, 'grammar', 'tina_line.json'), 'utf-8'));
const barCheer = JSON.parse(fs.readFileSync(path.join(tmp, 'grammar', 'bar_cheer.json'), 'utf-8'));
check('grammar multi-variant stays array', Array.isArray(barMood['bar_mood']) && Array.isArray(tinaLine['tina_line']));
check('grammar single-variant collapses to string', typeof barCheer['bar_cheer'] === 'string');

// slug sanity
check('slug rule', slug('Local Bar') === 'local_bar' && slug('Tina Bar Chat') === 'tina_bar_chat');

console.log(`\nDSL compile: ${written.length} files emitted to ${tmp}`);
