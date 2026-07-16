// ============================================================
// console.ts — Dev console REPL
// Provides text-based gameplay loop for testing the engine.
// Run with: npx ts-node src/console/index.ts
// ============================================================

import * as readline from 'readline';
import * as path from 'path';
import { loadGameData } from './loader';
import { StateManager } from './state';
import { ConditionEvaluator } from './evaluator';
import {
  resolveVisibility,
  resolveAvailability,
  executeAction,
} from './actions';
import { runRestCycle } from './rest';
import { 
  Action, 
  GameState, 
  NPCState, 
  NPCLocation,
  Event,
  EventChoice,
  Dialogue,
  DialogueNode,
  DialogueChoice,
} from './types';
import { QuestManager } from './quest';
import {
  evaluateLocationEvents,
  markEventFired,
  applyEventRewards,
} from './random_events';
import {
  loadEvent,
  getEventWithAvailableChoices,
  resolveEventChoice,
  evaluateActionEventTrigger,
} from './events';
import {
  loadDialogue,
  enterNode,
  resolveDialogueChoice,
} from './dialogue';
import { saveGame, loadGame, listSlots } from './save';

// ── Console State ────────────────────────────────────────────

interface ConsoleState {
  stateManager: StateManager;
  evaluator: ConditionEvaluator;
  // Loaded data needed by rest cycle and action execution
  actions: Action[];
  events: Record<string, Event>;
  dialogues: Record<string, Dialogue>;
  gameDataNPCs: Record<string, any>;
  gameDataLocations: Record<string, any>;
  questManager: QuestManager;
  savesDir: string;
  // Event mode: when an interactive event is active, numeric input routes to choices
  eventMode?: {
    event: Event;
    availableChoices: EventChoice[];
  };
  // Dialogue mode: when a conversation is active, numeric input routes to responses
  dialogueMode?: {
    dialogue: Dialogue;
    node: DialogueNode;
    availableResponses: DialogueChoice[];
  };
}

// ── Helpers ──────────────────────────────────────────────────

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function cyan(text: string): string {
  return `\x1b[36m${text}\x1b[0m`;
}

function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

function red(text: string): string {
  return `\x1b[31m${text}\x1b[0m`;
}

// ── Display Helpers ─────────────────────────────────────────

function displayWelcome() {
  console.log(bold('\n════════════════════════════════════════════════════'));
  console.log(bold('   STAT-GATED STATE MACHINE GAME ENGINE'));
  console.log(bold('   Dev Console REPL'));
  console.log(bold('════════════════════════════════════════════════════\n'));
  console.log('Type ' + cyan('help') + ' for commands.\n');
}

function getNPCsAtLocation(locationId: string, state: GameState, evaluator: ConditionEvaluator): string[] {
  return Object.entries(state.npcs)
    .filter(([_, npc]: [string, NPCState]) =>
      npc.locations?.some(
        (loc: NPCLocation) =>
          loc.location_id === locationId &&
          (loc.conditions === null || evaluator.evaluateAll(loc.conditions, state))
      )
    )
    .map(([npcId]) => npcId);
}

function displayLocation(cons: ConsoleState) {
  const state = cons.stateManager.getState();
  const currentLocationId = state.global.current_location_id;
  const global = cons.stateManager.getGlobal();
  const player = cons.stateManager.getPlayer();

  console.log('\n' + bold(`═══ Location: ${currentLocationId} ═══`));
  console.log(`Day ${global.day.count} | Phase ${global.world_phase.current} | Money: $${player.economy.balance}`);
  
  const npcIds = getNPCsAtLocation(currentLocationId, state, cons.evaluator);
  if (npcIds.length > 0) {
    const npcNames = npcIds.map(id => state.npcs[id]?.name || id).join(', ');
    console.log(`NPCs: ${npcNames}`);
  }
  console.log();
}

function displayActions(cons: ConsoleState, actions: Action[]) {
  if (actions.length === 0) {
    console.log(yellow('No actions available here.'));
    return;
  }

  const state = cons.stateManager.getState();

  console.log(bold('Available Actions:'));
  actions.forEach((action, idx) => {
    const visibility = resolveVisibility(action, state, cons.evaluator);
    const availability = visibility.visible
      ? resolveAvailability(action, state, cons.evaluator)
      : null;

    if (!visibility.visible) {
      // Hidden action, don't show
      return;
    }

    const available = availability?.available ?? false;
    const indicator = available ? green('✓') : red('✗');
    const reason =
      !available && !availability?.available
        ? ` (${(availability as any).reason})`
        : '';

    console.log(
      `  ${indicator} [${idx}] ${cyan(action.name)}: ${action.description}${reason}`
    );
  });
  console.log();
}

function displayStatus(cons: ConsoleState) {
  const state = cons.stateManager.getState();
  const global = state.global;
  const player = state.player;

  console.log('\n' + bold('═══ Player Status ═══'));
  console.log(`Name: ${(player as any).name || '(unnamed)'}`);
  console.log(`Day: ${global.day.count}`);
  console.log(`Current Location: ${global.current_location_id}`);
  console.log(`World Phase: ${global.world_phase.current}`);
  console.log(`Money: $${player.economy.balance}`);

  console.log('\n' + bold('Stats:'));
  for (const [statId, stat] of Object.entries(player.stats)) {
    console.log(
      `  ${statId}: ${stat.value}/${stat.max}`
    );
  }

  console.log('\n' + bold('Inventory:'));
  const consumables = Object.entries(player.inventory.consumables).map(
    ([id, inv]) => `${id} x${inv.quantity}`
  );
  const keyItems = Object.keys(player.inventory.key_items);
  const gifts = Object.entries(player.inventory.gifts).map(
    ([id, inv]) => `${id} x${inv.quantity}`
  );

  if (consumables.length > 0) console.log(`  Consumables: ${consumables.join(', ')}`);
  if (keyItems.length > 0) console.log(`  Key Items: ${keyItems.join(', ')}`);
  if (gifts.length > 0) console.log(`  Gifts: ${gifts.join(', ')}`);

  if (consumables.length === 0 && keyItems.length === 0 && gifts.length === 0) {
    console.log('  (empty)');
  }

  console.log();
}

function displayNPCStats(cons: ConsoleState, npcId: string) {
  const state = cons.stateManager.getState();
  const npc = state.npcs[npcId];
  
  if (!npc) {
    console.log(red(`\nNPC not found: ${npcId}`));
    return;
  }

  console.log('\n' + bold(`═══ ${npcId.toUpperCase()} ═══`));
  console.log(`Affection: ${npc.affection.value} (threshold: ${npc.affection.high_threshold})`);
  console.log(`Corruption: ${npc.corruption.value} (threshold: ${npc.corruption.high_threshold})`);
  
  if (Object.keys(npc.traits).length > 0) {
    console.log('\n' + bold('Traits:'));
    for (const [traitId, trait] of Object.entries(npc.traits)) {
      const unlocked = trait.unlocked ? '✓' : '✗';
      console.log(`  ${unlocked} ${traitId} (tier ${trait.current_tier})`);
    }
  }

  if (Object.keys(npc.flags).length > 0) {
    console.log('\n' + bold('Flags:'));
    for (const [flagId, flagValue] of Object.entries(npc.flags)) {
      console.log(`  ${flagId}: ${flagValue}`);
    }
  }

  console.log();
}

function displayExits(cons: ConsoleState) {
  const state = cons.stateManager.getState();
  const currentLocationId = state.global.current_location_id;
  const unlockedLocations = state.global.unlocked_locations;
  const availableExits = unlockedLocations.filter(loc => loc !== currentLocationId);

  if (availableExits.length === 0) {
    return;
  }

  console.log(bold('Exits:'));
  availableExits.forEach((exitId, idx) => {
    console.log(`  ${green('→')} [${idx}E] ${cyan(exitId)}`);
  });
  console.log();
}

function displayHelp() {
  console.log('\n' + bold('═══ Commands ═══'));
  console.log('  [0-9]   Execute numbered action');
  console.log('  [0-9]E  Travel to numbered exit (e.g., "0E" for first exit)');
  console.log('  status  Show detailed player status');
  console.log('  quest   Show all quest status');
  console.log('  npc     Show NPC stats (e.g., "npc alex")');
  console.log('  talk    Talk to an NPC (e.g., "talk alex")');
  console.log('  affection  Set NPC affection (e.g., "affection morgan 25")');
  console.log('  rest    Take the rest action (if available)');
  console.log('  save    Save the game (e.g., "save" or "save slot1")');
  console.log('  load    Load a saved game (e.g., "load" or "load slot1")');
  console.log('  saves   List save slots');
  console.log('  test_event <event_id>  Test event system (e.g., "test_event test_event_choice")');
  console.log('  help    Show this help');
  console.log('  quit    Exit the game');
  console.log();
}

function displayQuests(cons: ConsoleState) {
  const state = cons.stateManager.getState();
  const displayStatuses = cons.questManager.getDisplayStatuses(state);

  console.log('\n' + bold('═══ Quests ═══'));

  if (displayStatuses.length === 0) {
    console.log('  No quests available.');
    console.log();
    return;
  }

  for (const ds of displayStatuses) {
    switch (ds.status) {
      case 'completed':
        console.log(`  ${green('✓')} ${ds.name}: COMPLETED`);
        break;
      case 'failed':
        console.log(`  ${red('✗')} ${ds.name}: FAILED`);
        break;
      case 'not_started':
        console.log(`  ${yellow('○')} ${ds.name}: NOT STARTED`);
        break;
      case 'active':
        console.log(`  ${cyan('●')} ${ds.name}: ACTIVE — Stage ${ds.stage_index + 1}/${ds.total_stages}: ${ds.current_stage_description || 'Unknown stage'}`);
        break;
    }
  }
  console.log();
}

// ── Event Mode ───────────────────────────────────────────────

function enterEventMode(cons: ConsoleState, eventId: string): boolean {
  const state = cons.stateManager.getState();
  const result = getEventWithAvailableChoices(cons.events, eventId, state, cons.evaluator);

  if (!result) {
    console.log(red(`Event not found: ${eventId}`));
    return false;
  }

  if (result.available_choices.length === 0) {
    console.log(yellow('Event has no available choices. It resolves automatically.'));
    return false;
  }

  cons.eventMode = {
    event: result.event,
    availableChoices: result.available_choices,
  };
  return true;
}

function displayEvent(cons: ConsoleState) {
  if (!cons.eventMode) return;

  const { event, availableChoices } = cons.eventMode;

  console.log('\n' + bold('═══ Event ═══'));
  console.log(event.text);

  if (availableChoices.length > 0) {
    console.log(bold('\nChoices:'));
    availableChoices.forEach((choice, idx) => {
      console.log(`  [${idx}] ${choice.text}`);
    });
  }
  console.log();
}

function displayEventResult(success: boolean, reason: string | undefined, effects: any[]) {
  if (!success) {
    console.log(red(`\nChoice failed: ${reason}`));
    return;
  }

  console.log('\n' + bold('═══ Event Result ═══'));
  console.log('\n' + bold('Effects:'));
  for (const effect of effects) {
    console.log(`  • ${effect.detail}`);
  }
  console.log();
}

// ── Dialogue Mode ────────────────────────────────────────────

// Enter a dialogue at the given node (defaults to root), resolving
// conditional auto-routing first. Returns false if the dialogue or
// resolved node can't be shown (unknown id, or no available responses).
function enterDialogueMode(cons: ConsoleState, dialogueId: string, nodeId?: string): boolean {
  const dialogue = loadDialogue(cons.dialogues, dialogueId);
  if (!dialogue) {
    console.log(red(`Dialogue not found: ${dialogueId}`));
    return false;
  }

  const startNodeId = nodeId ?? dialogue.root_node_id;
  const entered = enterNode(dialogue, startNodeId, cons.stateManager.getState(), cons.evaluator);
  if (!entered) {
    console.log(red(`Dialogue node not found: ${startNodeId}`));
    return false;
  }

  if (entered.available_responses.length === 0) {
    // A node with no available responses is a conversation dead-end.
    console.log('\n' + bold('═══ Dialogue ═══'));
    console.log(entered.node.text);
    console.log(yellow('\n(They have nothing more to say.)\n'));
    return false;
  }

  cons.dialogueMode = {
    dialogue,
    node: entered.node,
    availableResponses: entered.available_responses,
  };
  return true;
}

function displayDialogue(cons: ConsoleState) {
  if (!cons.dialogueMode) return;

  const { dialogue, node, availableResponses } = cons.dialogueMode;
  const speaker = node.speaker ?? cons.gameDataNPCs[dialogue.npc_id]?.name ?? dialogue.npc_id;

  console.log('\n' + bold('═══ Dialogue ═══'));
  console.log(`${bold(speaker)}: ${node.text}`);

  console.log(bold('\nResponses:'));
  availableResponses.forEach((choice, idx) => {
    console.log(`  [${idx}] ${choice.text}`);
  });
  console.log();
}

// ── Action Execution ────────────────────────────────────────

function displayActionResult(cons: ConsoleState, actionId: string) {
  const action = cons.actions.find(a => a.id === actionId);
  if (!action) {
    console.log(red(`Action not found: ${actionId}`));
    return;
  }

  const result = executeAction(
    action,
    cons.stateManager,
    cons.evaluator,
    cons.gameDataLocations[cons.stateManager.getState().global.current_location_id]
  );

  if (!result.success) {
    console.log(red(`\nAction failed: ${result.reason}`));
    return;
  }

  console.log('\n' + bold('═══ Action Result ═══'));
  if (action.effects.text) {
    console.log(action.effects.text);
  }

  console.log('\n' + bold('Effects:'));
  for (const effect of result.effects) {
    console.log(`  • ${effect.detail}`);
  }

  if (result.quest_triggers.length > 0) {
    console.log('\n' + yellow(`Quest triggers: ${result.quest_triggers.join(', ')}`));
  }

  console.log();

  // If this was the rest action, also run the rest cycle
  if (actionId === 'rest') {
    const restResult = runRestCycle(
      cons.stateManager,
      cons.evaluator,
      cons.gameDataNPCs,
      cons.gameDataLocations
    );

    if (restResult.success) {
      // Reset action counters (they're stored in action objects, not state)
      for (const action of cons.actions) {
        action.availability.caps.daily.current = 0;
        action.availability.caps.lifetime.current = 0;
      }

      console.log(bold('═══ Morning ═══'));
      console.log('You wake up refreshed.');

      // New day has begun (runRestCycle advanced the day but intentionally
      // left `rested` set so it can't be run twice in one invocation). Clear
      // it now, on wake, so the player can rest again tonight.
      cons.stateManager.clearRested();

      if (restResult.notifications.length > 0) {
        console.log('\n' + bold('Overnight Summary:'));
        for (const notif of restResult.notifications) {
          console.log(`  • ${notif}`);
        }
      }
      console.log();
    }
  }

  // Check for action event trigger after effects are applied
  if (action.effects.event_id) {
    const eventId = evaluateActionEventTrigger(action.effects);
    if (eventId) {
      enterEventMode(cons, eventId);
    }
  }
}

// ── Main REPL Loop ──────────────────────────────────────────

async function startREPL(cons: ConsoleState) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(cyan('> '), async (input) => {
      const command = input.trim().toLowerCase();

      if (command === 'quit' || command === 'q') {
        console.log(yellow('\nThanks for playing!\n'));
        rl.close();
        return;
      }

      if (command === 'help') {
        displayHelp();
        promptNext();
        return;
      }

      if (command === 'status') {
        displayStatus(cons);
        promptNext();
        return;
      }

      if (command === 'quest') {
        displayQuests(cons);
        promptNext();
        return;
      }

      // Handle "saves" command — list save slots
      if (command === 'saves') {
        const slots = listSlots(cons.savesDir);
        if (slots.length === 0) {
          console.log(yellow('No saved games.'));
        } else {
          console.log(bold('\n═══ Save Slots ═══'));
          slots.forEach(s => console.log(`  • ${s}`));
        }
        promptNext();
        return;
      }

      // Handle "save [slot]" command — persist the game
      if (command === 'save' || command.startsWith('save ')) {
        const slot = command.split(' ')[1];  // undefined -> default slot
        try {
          const p = saveGame(cons.stateManager.getState(), cons.actions, cons.savesDir, slot);
          console.log(green(`Game saved to ${path.basename(p)}`));
        } catch (err) {
          console.log(red((err as Error).message));
        }
        promptNext();
        return;
      }

      // Handle "load [slot]" command — restore a saved game
      if (command === 'load' || command.startsWith('load ')) {
        const slot = command.split(' ')[1];
        try {
          const state = loadGame(cons.actions, cons.savesDir, slot);
          cons.stateManager = new StateManager(state);
          console.log(green(`Game loaded${slot ? ` from ${slot}` : ''}.`));
        } catch (err) {
          console.log(red((err as Error).message));
        }
        promptNext();
        return;
      }

      // Handle "talk <npc_id>" command — start a conversation
      if (command.startsWith('talk')) {
        const parts = command.split(' ');
        if (parts.length < 2) {
          console.log(yellow('Usage: talk <npc_id> (e.g., "talk alex")'));
          promptNext();
          return;
        }
        const npcId = parts[1];
        const dialogue = Object.values(cons.dialogues).find(d => d.npc_id === npcId);
        if (!dialogue) {
          console.log(yellow(`${npcId} has nothing to talk about right now.`));
          promptNext();
          return;
        }
        if (enterDialogueMode(cons, dialogue.id)) {
          displayDialogue(cons);
        }
        promptNext();
        return;
      }

      // Handle "npc <npc_id>" command
      if (command.startsWith('npc')) {
        const parts = command.split(' ');
        if (parts.length < 2) {
          console.log(yellow('Usage: npc <npc_id> (e.g., "npc alex")'));
          promptNext();
          return;
        }
        const npcId = parts[1];
        displayNPCStats(cons, npcId);
        promptNext();
        return;
      }

      // Handle "affection <npc_id> <value>" command
      if (command.startsWith('affection')) {
        const parts = command.split(' ');
        if (parts.length < 3) {
          console.log(yellow('Usage: affection <npc_id> <value> (e.g., "affection morgan 25")'));
          promptNext();
          return;
        }
        const npcId = parts[1];
        const value = parseInt(parts[2], 10);
        
        if (isNaN(value)) {
          console.log(red('Value must be a number'));
          promptNext();
          return;
        }

        try {
          const state = cons.stateManager.getState();
          const npc = state.npcs[npcId];
          if (!npc) {
            console.log(red(`NPC not found: ${npcId}`));
          } else {
            npc.affection.value = Math.max(0, Math.min(npc.affection.high_threshold, value));
            console.log(green(`Set ${npcId}'s affection to ${value}`));
          }
        } catch (err) {
          console.log(red(`Error: ${(err as Error).message}`));
        }
        promptNext();
        return;
      }

      if (command === 'rest') {
        const restResult = runRestCycle(
          cons.stateManager,
          cons.evaluator,
          cons.gameDataNPCs,
          cons.gameDataLocations
        );

        if (!restResult.success) {
          console.log(red(`\nRest failed: ${restResult.reason}`));
        } else {
          console.log('\n' + bold('═══ Morning ═══'));
          console.log('You wake up refreshed.');

          // New day begun — clear the rested flag on wake (see rest.ts note).
          cons.stateManager.clearRested();

          if (restResult.notifications.length > 0) {
            console.log('\n' + bold('Overnight Summary:'));
            for (const notif of restResult.notifications) {
              console.log(`  • ${notif}`);
            }
          }
        }

        console.log();
        promptNext();
        return;
      }

      // Handle "test_event <event_id>" command
      if (command.startsWith('test_event')) {
        const parts = command.split(' ');
        if (parts.length < 2) {
          console.log(yellow('Usage: test_event <event_id> (e.g., "test_event test_intro_event")'));
          promptNext();
          return;
        }
        const eventId = parts[1];

        if (enterEventMode(cons, eventId)) {
          promptNext(); // Will display the event
        } else {
          promptNext();
        }
        return;
      }

      // Handle "[0-9]E" exit command
      if (command.endsWith('E') || command.endsWith('e')) {
        const numStr = command.slice(0, -1);
        const exitNum = parseInt(numStr, 10);
        
        if (isNaN(exitNum)) {
          console.log(yellow('Unrecognized command. Type ' + cyan('help') + ' for options.'));
          promptNext();
          return;
        }

        const state = cons.stateManager.getState();
        const currentLocationId = state.global.current_location_id;
        const unlockedLocations = state.global.unlocked_locations;
        const availableExits = unlockedLocations.filter(loc => loc !== currentLocationId);

        if (exitNum < 0 || exitNum >= availableExits.length) {
          console.log(red(`Invalid exit number: ${exitNum}`));
          promptNext();
          return;
        }

        const targetLocation = availableExits[exitNum];
        cons.stateManager.setLocation(targetLocation);
        console.log(cyan(`You travel to ${targetLocation}.`));
        console.log();

        // Check location events (random_events + event_triggers)
        const locationData = cons.gameDataLocations[targetLocation];
        if (locationData) {
          const eventResult = evaluateLocationEvents(
            locationData.random_events || [],
            locationData.event_triggers || null,
            cons.stateManager.getState(),
            cons.evaluator
          );

          if (eventResult.fired) {
            if (eventResult.resolution) {
              // Full random event with rewards
              // Mark cooldown
              const firedEvent = locationData.random_events?.find(
                (e: any) => e.event_id === eventResult.resolution!.event_id
              );
              if (firedEvent) {
                markEventFired(firedEvent, cons.stateManager.getState().global.day.count);
              }

              // Display event text
              console.log('\n' + bold('═══ Something Happens ═══'));
              console.log(eventResult.resolution.text);

              // Apply rewards
              const rewardResult = applyEventRewards(eventResult.resolution, cons.stateManager);
              if (rewardResult.notifications.length > 0) {
                console.log('\n' + bold('Effects:'));
                for (const notif of rewardResult.notifications) {
                  console.log(`  • ${notif}`);
                }
              }
              console.log();
            } else if (eventResult.triggered_event_id) {
              // Simple event trigger → enter interactive event mode
              enterEventMode(cons, eventResult.triggered_event_id);
            }
          }
        }

        promptNext();
        return;
      }

      // Try to parse as action number (or event choice if in event mode)
      const actionNum = parseInt(command, 10);
      if (!isNaN(actionNum)) {
        // Event mode: numeric input = choice selection
        if (cons.eventMode) {
          const { event, availableChoices } = cons.eventMode;
          if (actionNum >= 0 && actionNum < availableChoices.length) {
            const result = resolveEventChoice(event, actionNum, cons.stateManager, cons.evaluator);
            displayEventResult(result.success, result.reason, result.effects);

            if (result.quest_triggers.length > 0) {
              console.log(yellow(`Quest triggers: ${result.quest_triggers.join(', ')}`));
            }

            // Event chaining: if the chosen choice points to a follow-up event
            // (and it passes its probability roll), transition straight into it
            // and hand the new choices to the player. Otherwise exit event mode.
            const nextEventId = result.success
              ? evaluateActionEventTrigger(availableChoices[actionNum].effects)
              : null;
            cons.eventMode = undefined;
            if (nextEventId && enterEventMode(cons, nextEventId)) {
              displayEvent(cons);
            }
          } else {
            console.log(red(`Invalid choice number: ${actionNum}`));
          }
          promptNext();
          return;
        }

        // Dialogue mode: numeric input = response selection
        if (cons.dialogueMode) {
          const { dialogue, node, availableResponses } = cons.dialogueMode;
          if (actionNum >= 0 && actionNum < availableResponses.length) {
            const result = resolveDialogueChoice(node, actionNum, cons.stateManager, cons.evaluator);
            displayEventResult(result.success, result.reason, result.effects);

            if (result.quest_triggers.length > 0) {
              console.log(yellow(`Quest triggers: ${result.quest_triggers.join(', ')}`));
            }

            // Advance to the next node (which re-runs conditional routing) or
            // end the conversation when the response has no next_node_id.
            cons.dialogueMode = undefined;
            if (result.success && result.next_node_id) {
              if (enterDialogueMode(cons, dialogue.id, result.next_node_id)) {
                displayDialogue(cons);
              }
            }
          } else {
            console.log(red(`Invalid response number: ${actionNum}`));
          }
          promptNext();
          return;
        }

        const state = cons.stateManager.getState();
        const currentLocationId = state.global.current_location_id;

        // Get location-specific actions
        const locationActions = cons.actions.filter(
          (action) =>
            action.context.type === 'location' &&
            action.context.target_id === currentLocationId
        );
        
        // Get NPC actions for NPCs at this location
        const npcAtLocation = getNPCsAtLocation(currentLocationId, state, cons.evaluator);
        const npcActions: typeof cons.actions = [];
        
        for (const npcId of npcAtLocation) {
          const npcSpecificActions = cons.actions.filter(
            (action) =>
              action.context.type === 'npc' &&
              action.context.target_id === npcId
          );
          npcActions.push(...npcSpecificActions);
        }
        
        const availableActions = [...locationActions, ...npcActions];

        if (actionNum >= 0 && actionNum < availableActions.length) {
          const action = availableActions[actionNum];
          displayActionResult(cons, action.id);
          promptNext();
          return;
        } else {
          console.log(red(`Invalid action number: ${actionNum}`));
        }
      }

      // Unrecognized command
      console.log(yellow('Unrecognized command. Type ' + cyan('help') + ' for options.'));

      promptNext();
    });
  };

  const promptNext = () => {
    // If in event mode, display the event instead of the location
    if (cons.eventMode) {
      displayEvent(cons);
      prompt();
      return;
    }

    // If in dialogue mode, display the conversation instead of the location
    if (cons.dialogueMode) {
      displayDialogue(cons);
      prompt();
      return;
    }

    displayLocation(cons);
    displayExits(cons);
    const state = cons.stateManager.getState();
    const currentLocationId = state.global.current_location_id;
    
    // Get location-specific actions
    const locationActions = cons.actions.filter(
      (action) =>
        action.context.type === 'location' &&
        action.context.target_id === currentLocationId
    );
    
    // Get NPC actions for NPCs at this location
    const npcAtLocation = getNPCsAtLocation(currentLocationId, state, cons.evaluator);
    const npcActions: typeof cons.actions = [];
    
    for (const npcId of npcAtLocation) {
      const npcSpecificActions = cons.actions.filter(
        (action) =>
          action.context.type === 'npc' &&
          action.context.target_id === npcId
      );
      npcActions.push(...npcSpecificActions);
    }
    
    const availableActions = [...locationActions, ...npcActions];
    displayActions(cons, availableActions);
    prompt();
  };

  displayWelcome();
  promptNext();
}

// ── Initialization ──────────────────────────────────────────

async function main() {
  try {
    // Load all game data
    const dataDir = path.join(__dirname, 'data');
    const gameData = loadGameData(dataDir);

    // Initialize engine systems
    const stateManager = new StateManager(gameData.state);
    const evaluator = new ConditionEvaluator(gameData.conditionLibrary);

    const cons: ConsoleState = {
      stateManager,
      evaluator,
      actions: gameData.actions,
      events: gameData.events,
      dialogues: gameData.dialogues,
      gameDataNPCs: gameData.npcs,
      gameDataLocations: gameData.locations,
      questManager: new QuestManager(gameData.quests),
      savesDir: path.join(__dirname, 'saves'),
    };

    // Start REPL
    await startREPL(cons);
  } catch (err) {
    console.error('Failed to initialize console:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});