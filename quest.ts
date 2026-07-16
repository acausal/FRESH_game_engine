// ============================================================
// quest.ts — Quest evaluation system
// Handles quest lifecycle: initiation, stage progression,
// completion, failure, and reward application.
// ============================================================

import { ConditionEvaluator } from './evaluator';
import { StateManager } from './state';
import {
  Quest,
  QuestStatus,
  GameState,
  ActionEffects,
} from './types';

// ── Result Types ─────────────────────────────────────────────

export interface QuestInitiationResult {
  success: boolean;
  quest_id?: string;
  quest_name?: string;
  notification?: string;
}

export interface StageCompletionResult {
  success: boolean;
  quest_id?: string;
  quest_name?: string;
  stage_index?: number;
  quest_complete?: boolean;
  next_stage_description?: string;
  notifications: string[];
}

export interface QuestEvaluationResult {
  initiations: QuestInitiationResult[];
  completions: StageCompletionResult[];
  failures: Array<{ quest_id: string; quest_name: string; notification: string }>;
}

export interface QuestDisplayStatus {
  quest_id: string;
  name: string;
  description: string;
  status: 'not_started' | 'active' | 'completed' | 'failed';
  stage_index: number;
  total_stages: number;
  current_stage_description?: string;
}

// ── Quest Manager ────────────────────────────────────────────

export class QuestManager {
  private quests: Record<string, Quest>;

  constructor(quests: Record<string, Quest>) {
    this.quests = quests;
  }

  // ── Status Queries ──────────────────────────────────────────

  getDisplayStatuses(state: GameState): QuestDisplayStatus[] {
    const statuses: QuestDisplayStatus[] = [];

    for (const [questId, quest] of Object.entries(this.quests)) {
      const questState = state.global.quest_states[questId];
      if (!questState) continue;

      if (questState.completed) {
        statuses.push({
          quest_id: questId,
          name: quest.name,
          description: quest.description,
          status: 'completed',
          stage_index: questState.current_stage_index,
          total_stages: quest.stages.length,
        });
      } else if (questState.failed) {
        statuses.push({
          quest_id: questId,
          name: quest.name,
          description: quest.description,
          status: 'failed',
          stage_index: questState.current_stage_index,
          total_stages: quest.stages.length,
        });
      } else if (
        questState.started_at.day === 0 &&
        questState.started_at.phase === 0 &&
        questState.current_stage_index === 0
      ) {
        statuses.push({
          quest_id: questId,
          name: quest.name,
          description: quest.description,
          status: 'not_started',
          stage_index: 0,
          total_stages: quest.stages.length,
        });
      } else {
        const stage = quest.stages[questState.current_stage_index];
        statuses.push({
          quest_id: questId,
          name: quest.name,
          description: quest.description,
          status: 'active',
          stage_index: questState.current_stage_index,
          total_stages: quest.stages.length,
          current_stage_description: stage?.description,
        });
      }
    }

    return statuses;
  }

  // ── Evaluation Entry Points ─────────────────────────────────

  /**
   * Evaluate all quests after an action has been executed.
   * Processes quest triggers (from action effects) and checks
   * progression for all active quests.
   */
  evaluateAfterAction(
    triggeredQuestIds: string[],
    stateManager: StateManager,
    evaluator: ConditionEvaluator
  ): QuestEvaluationResult {
    const state = stateManager.getState();
    const day = state.global.day.count;
    const phase = state.global.world_phase.current;

    const initiations: QuestInitiationResult[] = [];
    const completions: StageCompletionResult[] = [];
    const failures: Array<{ quest_id: string; quest_name: string; notification: string }> = [];

    for (const [questId, status] of Object.entries(state.global.quest_states)) {
      const quest = this.quests[questId];
      if (!quest) continue;

      // Skip completed or failed quests
      if (status.completed || status.failed) continue;

      // Check if quest hasn't started yet
      const notStarted =
        status.started_at.day === 0 &&
        status.started_at.phase === 0 &&
        status.current_stage_index === 0;

      if (notStarted) {
        // Try to initiate via trigger or auto-start
        const initiation = this.tryInitiateQuest(
          questId, quest, status, triggeredQuestIds, stateManager, evaluator, day, phase
        );
        if (initiation.success) {
          initiations.push(initiation);
          // After initiation, check if the first stage can complete immediately
          const completion = this.checkStageCompletion(questId, quest, stateManager, evaluator, day, phase);
          if (completion.success) {
            completions.push(completion);
          }
        }
      } else {
        // Quest is active — check for failure and completion
        const failResult = this.checkQuestFailure(questId, quest, status, stateManager, evaluator);
        if (failResult) {
          failures.push(failResult);
          continue;
        }

        const completion = this.checkStageCompletion(questId, quest, stateManager, evaluator, day, phase);
        if (completion.success) {
          completions.push(completion);
        }
      }
    }

    return { initiations, completions, failures };
  }

  /**
   * Evaluate all quests during the rest cycle.
   * Checks auto-start conditions and progression for all quests.
   */
  evaluateDuringRestCycle(
    stateManager: StateManager,
    evaluator: ConditionEvaluator
  ): QuestEvaluationResult {
    const state = stateManager.getState();
    const day = state.global.day.count;
    const phase = state.global.world_phase.current;

    const initiations: QuestInitiationResult[] = [];
    const completions: StageCompletionResult[] = [];
    const failures: Array<{ quest_id: string; quest_name: string; notification: string }> = [];

    for (const [questId, status] of Object.entries(state.global.quest_states)) {
      const quest = this.quests[questId];
      if (!quest) continue;

      // Skip completed or failed quests
      if (status.completed || status.failed) continue;

      // Check if quest hasn't started yet
      const notStarted =
        status.started_at.day === 0 &&
        status.started_at.phase === 0 &&
        status.current_stage_index === 0;

      if (notStarted) {
        const initiation = this.tryInitiateQuest(
          questId, quest, status, [], stateManager, evaluator, day, phase
        );
        if (initiation.success) {
          initiations.push(initiation);
          const completion = this.checkStageCompletion(questId, quest, stateManager, evaluator, day, phase);
          if (completion.success) {
            completions.push(completion);
          }
        }
      } else {
        // Quest is active
        const failResult = this.checkQuestFailure(questId, quest, status, stateManager, evaluator);
        if (failResult) {
          failures.push(failResult);
          continue;
        }

        const completion = this.checkStageCompletion(questId, quest, stateManager, evaluator, day, phase);
        if (completion.success) {
          completions.push(completion);
        }
      }
    }

    return { initiations, completions, failures };
  }

  // ── Core Quest Logic ────────────────────────────────────────

  private tryInitiateQuest(
    questId: string,
    quest: Quest,
    status: QuestStatus,
    triggeredQuestIds: string[],
    stateManager: StateManager,
    evaluator: ConditionEvaluator,
    day: number,
    phase: number
  ): QuestInitiationResult {
    const state = stateManager.getState();

    // Check if triggered by action
    if (triggeredQuestIds.includes(questId)) {
      stateManager.startQuest(questId, day, phase);
      return {
        success: true,
        quest_id: questId,
        quest_name: quest.name,
        notification: `Quest started: ${quest.name}`,
      };
    }

    // Check auto-start conditions
    if (quest.auto_start.conditions && quest.auto_start.conditions.length > 0) {
      const autoStartMet = evaluator.evaluateAll(quest.auto_start.conditions, state);
      if (autoStartMet) {
        stateManager.startQuest(questId, day, phase);
        return {
          success: true,
          quest_id: questId,
          quest_name: quest.name,
          notification: `Quest started: ${quest.name}`,
        };
      }
    }

    return { success: false };
  }

  private checkStageCompletion(
    questId: string,
    quest: Quest,
    stateManager: StateManager,
    evaluator: ConditionEvaluator,
    day: number,
    phase: number
  ): StageCompletionResult {
    const state = stateManager.getState();
    const status = state.global.quest_states[questId];
    if (!status) return { success: false, notifications: [] };

    const currentStage = quest.stages[status.current_stage_index];
    if (!currentStage) return { success: false, notifications: [] };

    const notifications: string[] = [];

    // Check completion conditions
    let completionMet = false;

    if (currentStage.completion_conditions && currentStage.completion_conditions.length > 0) {
      completionMet = evaluator.evaluateAll(currentStage.completion_conditions, state);
    } else if (status.current_stage_index === quest.stages.length - 1) {
      // Final stage with no completion conditions auto-completes
      completionMet = true;
    }

    if (!completionMet) {
      return { success: false, notifications: [] };
    }

    // Apply stage rewards
    if (currentStage.on_complete) {
      this.applyEffects(currentStage.on_complete, stateManager, notifications);
    }

    // Check if this is the final stage
    const isFinalStage = status.current_stage_index === quest.stages.length - 1;

    if (isFinalStage) {
      stateManager.completeQuest(questId);
      return {
        success: true,
        quest_id: questId,
        quest_name: quest.name,
        stage_index: status.current_stage_index,
        quest_complete: true,
        notifications: [
          ...notifications,
          `Quest completed: ${quest.name}`,
        ],
      };
    } else {
      // Capture next stage BEFORE advancing
      const nextStage = quest.stages[status.current_stage_index + 1];
      stateManager.advanceQuestStage(questId, day, phase);
      return {
        success: true,
        quest_id: questId,
        quest_name: quest.name,
        stage_index: status.current_stage_index - 1, // previous stage index
        quest_complete: false,
        next_stage_description: nextStage?.description,
        notifications: [
          ...notifications,
          `Quest progress: ${nextStage?.description || 'next stage'}`,
        ],
      };
    }
  }

  private checkQuestFailure(
    questId: string,
    quest: Quest,
    status: QuestStatus,
    stateManager: StateManager,
    evaluator: ConditionEvaluator
  ): { quest_id: string; quest_name: string; notification: string } | null {
    const state = stateManager.getState();
    const currentStage = quest.stages[status.current_stage_index];
    if (!currentStage) return null;

    if (currentStage.fail_conditions && currentStage.fail_conditions.length > 0) {
      const failMet = evaluator.evaluateAll(currentStage.fail_conditions, state);
      if (failMet) {
        stateManager.failQuest(questId);
        return {
          quest_id: questId,
          quest_name: quest.name,
          notification: `Quest failed: ${quest.name}`,
        };
      }
    }

    return null;
  }

  // ── Effect Application ──────────────────────────────────────
  // Applies ActionEffects (used for quest rewards, same structure as action effects)

  private applyEffects(
    effects: ActionEffects,
    stateManager: StateManager,
    notifications: string[]
  ): void {
    // Text notification
    if (effects.text) {
      notifications.push(effects.text);
    }

    // Money
    if (effects.money_delta !== null && effects.money_delta !== undefined) {
      stateManager.adjustBalance(effects.money_delta);
      notifications.push(`Money ${effects.money_delta > 0 ? '+' : ''}${effects.money_delta}`);
    }

    // Item grants
    if (effects.item_grants) {
      for (const grant of effects.item_grants) {
        let itemType: 'consumable' | 'key_item' | 'gift' = 'consumable';
        const item = stateManager.getItem(grant.item_id);
        if (item) {
          if (item.item_type === 'key_item') itemType = 'key_item';
          else if (item.item_type === 'gift') itemType = 'gift';
        }
        stateManager.grantItem(grant.item_id, grant.quantity, itemType);
        notifications.push(`Received ${grant.item_id} (quest reward)`);
      }
    }

    // Player flags
    if (effects.player_flags) {
      stateManager.setPlayerFlags(effects.player_flags);
      for (const [flagId, val] of Object.entries(effects.player_flags)) {
        notifications.push(`Flag: ${flagId} = ${val}`);
      }
    }

    // NPC effects
    if (effects.npc_effects) {
      const { npc_id, affection, corruption, trait_bumps, flags: npcFlags } = effects.npc_effects;

      if (affection !== null && affection !== undefined) {
        stateManager.bumpNPCAxis(npc_id, 'affection', affection, {});
        notifications.push(`${npc_id} affection ${affection > 0 ? '+' : ''}${affection}`);
      }

      if (corruption !== null && corruption !== undefined) {
        stateManager.bumpNPCAxis(npc_id, 'corruption', corruption, {});
        notifications.push(`${npc_id} corruption ${corruption > 0 ? '+' : ''}${corruption}`);
      }

      if (trait_bumps) {
        stateManager.bumpNPCTrait(npc_id, trait_bumps.trait_id, trait_bumps.value);
        notifications.push(`${npc_id} ${trait_bumps.trait_id} ${trait_bumps.value > 0 ? '+' : ''}${trait_bumps.value}`);
      }

      if (npcFlags) {
        stateManager.setNPCFlags(npc_id, npcFlags);
        for (const [flagId, val] of Object.entries(npcFlags)) {
          notifications.push(`${npc_id}.${flagId} = ${val}`);
        }
      }
    }

    // Global emissions
    if (effects.global_emissions) {
      stateManager.emitGlobal(effects.global_emissions);
      for (const emission of effects.global_emissions) {
        notifications.push(`Global: ${emission.flag} = ${emission.value}`);
      }
    }

    // Stat bumps
    if (effects.stat_bumps) {
      stateManager.bumpPlayerStat(effects.stat_bumps.stat_id, effects.stat_bumps.value);
      notifications.push(`${effects.stat_bumps.stat_id} ${effects.stat_bumps.value > 0 ? '+' : ''}${effects.stat_bumps.value}`);
    }
  }
}
