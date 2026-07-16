// ============================================================
// save.ts — Save / load persistence
// Serializes a full GameState to a named slot file and restores it.
//
// GOTCHA HANDLED: action cap counters (caps.daily.current /
// caps.lifetime.current) live in the Action[] objects, NOT in
// GameState. A GameState-only save would silently lose them —
// daily caps self-heal on rest but lifetime caps would corrupt.
// We snapshot them into a `action_caps` sidecar on save and
// re-apply them onto the live Action[] on load.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { GameState, Action } from './types';

const SAVE_VERSION = 1;
const DEFAULT_SLOT = 'autosave';

// ── Save Errors ───────────────────────────────────────────────

export class SaveError extends Error {
  constructor(file: string, message: string) {
    super(`[SaveError] ${file}: ${message}`);
    this.name = 'SaveError';
  }
}

// ── Save File Shape ───────────────────────────────────────────

interface ActionCapSnapshot {
  daily: number;
  lifetime: number;
}

export interface SaveFile {
  version: number;
  saved_at: string;               // ISO timestamp
  state: GameState;
  action_caps: Record<string, ActionCapSnapshot>;  // keyed by action id
}

// ── Path Helpers ──────────────────────────────────────────────

export function slotPath(savesDir: string, slot: string): string {
  // Guard against path traversal / separators in slot names.
  const safe = slot.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(savesDir, `${safe}.json`);
}

// ── Save ──────────────────────────────────────────────────────

// BEGIN: Save game
// Serializes state + action caps to a slot file. Returns the path written.
export function saveGame(
  state: GameState,
  actions: Action[],
  savesDir: string,
  slot: string = DEFAULT_SLOT
): string {
  const action_caps: Record<string, ActionCapSnapshot> = {};
  for (const action of actions) {
    action_caps[action.id] = {
      daily: action.availability.caps.daily.current,
      lifetime: action.availability.caps.lifetime.current,
    };
  }

  const savedAt = new Date().toISOString();

  // Stamp the session block so an inspected save shows when it was written.
  state.global.session.save_timestamp = savedAt;

  const save: SaveFile = {
    version: SAVE_VERSION,
    saved_at: savedAt,
    state,
    action_caps,
  };

  const filePath = slotPath(savesDir, slot);
  try {
    if (!fs.existsSync(savesDir)) {
      fs.mkdirSync(savesDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(save, null, 2), 'utf-8');
  } catch (err) {
    throw new SaveError(filePath, `Failed to write save: ${err}`);
  }
  return filePath;
}
// END: Save game

// ── Load ──────────────────────────────────────────────────────

// BEGIN: Load game
// Reads a slot file, validates it, re-applies action cap counters onto
// the live Action[], and returns the restored GameState.
export function loadGame(
  actions: Action[],
  savesDir: string,
  slot: string = DEFAULT_SLOT
): GameState {
  const filePath = slotPath(savesDir, slot);
  if (!fs.existsSync(filePath)) {
    throw new SaveError(filePath, 'Save slot not found.');
  }

  let save: SaveFile;
  try {
    save = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as SaveFile;
  } catch (err) {
    throw new SaveError(filePath, `Failed to parse save: ${err}`);
  }

  if (save.version !== SAVE_VERSION) {
    throw new SaveError(filePath, `Incompatible save version ${save.version} (expected ${SAVE_VERSION}).`);
  }
  if (!save.state || !save.state.global) {
    throw new SaveError(filePath, 'Save file missing game state.');
  }

  // Re-apply action cap counters onto the live Action objects. Actions
  // absent from the snapshot keep their current (freshly loaded) values.
  const caps = save.action_caps || {};
  for (const action of actions) {
    const snap = caps[action.id];
    if (snap) {
      action.availability.caps.daily.current = snap.daily;
      action.availability.caps.lifetime.current = snap.lifetime;
    }
  }

  return save.state;
}
// END: Load game

// ── List ──────────────────────────────────────────────────────

// BEGIN: List save slots
export function listSlots(savesDir: string): string[] {
  if (!fs.existsSync(savesDir)) return [];
  return fs.readdirSync(savesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .sort();
}
// END: List save slots
