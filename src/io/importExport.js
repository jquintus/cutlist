// Import and export, and the one place a project ever becomes the live one.
//
// A rejected import has to leave the project already on screen completely
// untouched. That is a property of where the assignment happens, not of how
// carefully the error is worded, so the store below has exactly one
// assignment and every import path has to go through it.

import { stampForSave } from '../model.js';
import { validateProject } from './validate.js';
import { decodeHash } from '../share/codec.js';
import { projectJson } from '../share/upload.js';

/**
 * Stamp the metadata a saved project carries and serialize it.
 *
 * `now` is injectable so a test gets a fixed date instead of today's.
 */
export function exportProjectJson(project, { now = () => new Date() } = {}) {
  return projectJson(stampForSave(project, { now }));
}

/** Parse and validate a file's text without touching anything. */
export function readProjectJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not valid JSON.' };
  }
  const checked = validateProject(parsed);
  if (!checked.ok) return { ok: false, field: checked.field, message: checked.message };
  return { ok: true, project: checked.project };
}

/**
 * Holds the project the app is currently showing.
 *
 * Every import is built and validated in full first and only then handed to
 * `load`, which is the single assignment in this module.
 */
export function createProjectStore(initialProject) {
  let current = initialProject;

  const load = (project) => {
    current = project; // The only assignment to the live project, anywhere.
    return { ok: true, project: current };
  };

  return {
    get current() {
      return current;
    },
    load,
    /** Replace the live project from a file's text, or leave it alone and say why. */
    importJsonText(text) {
      const result = readProjectJson(text);
      if (!result.ok) return result;
      return load(result.project);
    },
    /** Replace the live project from a share link fragment, or leave it alone and say why. */
    importShareHash(hash) {
      const result = decodeHash(hash);
      if (!result.ok) return { ok: false, message: result.error };
      return load(result.project);
    },
  };
}
