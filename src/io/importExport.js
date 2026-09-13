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

/**
 * Would this project come back if it were written out and read again?
 *
 * Export and Import have to agree about what a project is, and so do Save and
 * Open: a project that goes out through one door and is refused at the other
 * is work that was reported kept and then silently lost. The app can be walked
 * into a project the chain rejects -- a part added before any material group
 * exists, a group deleted out from under its parts -- so the way out is to run
 * the reading chain before writing anything and say what is wrong while the
 * project is still on screen to fix.
 *
 * Returns { ok: true } or { ok: false, field, message }.
 */
export function checkReadsBack(project) {
  const checked = validateProject(stampForSave(project));
  return checked.ok ? { ok: true } : { ok: false, field: checked.field, message: checked.message };
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
