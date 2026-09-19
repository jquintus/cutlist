import { normalizeProject, SCHEMA_VERSION } from '../model.js';

export const RECOVERY_KEY = 'cutlist:project-recovery';

/** Keep a synchronous, per-tab copy that survives reload without affecting share links. */
export function saveRecovery(storage, project) {
  try {
    storage.setItem(RECOVERY_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recovery preserves an in-progress form, so it deliberately accepts blanks
 * that a finished import/share link rejects. It still requires this schema and
 * normalizes every field before anything reaches live state.
 */
export function loadRecovery(storage) {
  let text;
  try {
    text = storage.getItem(RECOVERY_KEY);
  } catch {
    return { ok: false, error: 'Recovery storage is unavailable.' };
  }
  if (text === null) return { ok: false, error: 'There is no recovery copy.' };

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The recovery copy is damaged.' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'The recovery copy is not a cutlist project.' };
  }
  if (Number(parsed.schemaVersion) !== SCHEMA_VERSION) {
    return { ok: false, error: 'The recovery copy uses an unsupported schema.' };
  }
  return { ok: true, project: normalizeProject(parsed) };
}
