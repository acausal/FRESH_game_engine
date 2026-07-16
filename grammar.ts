// ============================================================
// grammar.ts — Procedural text generation via Tracery
// Loads and manages grammar rules for action text, notifications, etc.
// ============================================================

import * as tracery from 'tracery-grammar';

// Cached grammar instance (loaded once at startup)
let cachedGrammar: any = null;

// Load all grammar files and merge into single grammar object
function loadAllGrammar(): any {
  try {
    const actionsGrammar = require('./grammar/actions.json');
    const notificationsGrammar = require('./grammar/notifications.json');
    
    // Merge all grammar sources
    // Later files override earlier ones if there are conflicts
    const merged = {
      ...actionsGrammar,
      ...notificationsGrammar,
    };
    
    // Create a Tracery grammar object from the merged rules
    const grammar = tracery.createGrammar(merged);
    console.log('[Grammar] Loaded', Object.keys(merged).length, 'rules');
    return grammar;
  } catch (error) {
    console.error('[Grammar] Failed to load grammar files:', error);
    return tracery.createGrammar({});
  }
}

// Get the global grammar object (lazy load, cached)
export function getGrammar(): any {
  if (!cachedGrammar) {
    cachedGrammar = loadAllGrammar();
  }
  return cachedGrammar;
}

// Expand a grammar key into text
// Returns the expanded text, or falls back to the key itself if not found
export function expandText(textKey: string, grammar?: any): string {
  const g = grammar || getGrammar();
  try {
    const expanded = g.flatten(`#${textKey}#`);
    return expanded;
  } catch (error) {
    console.warn(`[Grammar] Failed to expand key "${textKey}":`, error instanceof Error ? error.message : error);
    return `((${textKey}))`;  // Return key in parens as visual indicator
  }
}

// Expand text with context variables (for notifications, etc.)
// Allows passing NPC names, trait names, etc. to grammar
export function expandTextWithContext(
  textKey: string,
  context: Record<string, any>,
  grammar?: any
): string {
  const g = grammar || getGrammar();
  try {
    // Merge context into the existing grammar temporarily
    const augmentedGrammar = tracery.createGrammar({
      // Load all existing rules first
      ...require('./grammar/actions.json'),
      ...require('./grammar/notifications.json'),
      // Then override/add context variables
      ...context
    });
    const expanded = augmentedGrammar.flatten(`#${textKey}#`);
    return expanded;
  } catch (error) {
    console.warn(`[Grammar] Failed to expand key "${textKey}" with context:`, error instanceof Error ? error.message : error);
    return `((${textKey}))`;
  }
}

// Reload grammar from disk (for development/testing)
export function reloadGrammar(): void {
  cachedGrammar = null;
}

