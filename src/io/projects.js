// Projects committed to this repository.
//
// The picker is a convenience, never a dependency. A missing or unreachable
// index leaves the app fully usable, because the important case is opening a
// share link on a phone with no signal at the back of a shop.

import { validateProject } from './validate.js';

const INDEX_PATH = 'projects/index.json';

// Only a plain file name, so nothing in the index can point the fetch at
// another path on the origin.
const SAFE_FILE = /^[A-Za-z0-9._-]+\.json$/;

async function fetchJson(path, fetchImpl) {
  const response = await fetchImpl(path, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }
  return response.json();
}

/**
 * Read the generated index of in-repo projects.
 *
 * Always resolves. On any failure it reports an empty list with a message for
 * the UI to show beside an empty picker.
 */
export async function loadProjectIndex(fetchImpl = fetch) {
  try {
    const data = await fetchJson(INDEX_PATH, fetchImpl);
    if (!data || !Array.isArray(data.projects)) {
      return { ok: false, projects: [], message: 'The saved project list is not in a shape this build understands.' };
    }
    const projects = data.projects.filter((entry) =>
      entry && typeof entry.file === 'string' && SAFE_FILE.test(entry.file));
    return { ok: true, projects };
  } catch {
    return {
      ok: false,
      projects: [],
      message: 'No saved projects are available right now. You can still build a project here or open a share link.',
    };
  }
}

/**
 * Read one committed project file, through the same validation chain a file
 * import and a share link use.
 */
export async function loadProjectFile(file, fetchImpl = fetch) {
  if (typeof file !== 'string' || !SAFE_FILE.test(file)) {
    return { ok: false, message: 'That is not a project file name.' };
  }
  let raw;
  try {
    raw = await fetchJson(`projects/${file}`, fetchImpl);
  } catch {
    return { ok: false, message: `Could not load projects/${file}.` };
  }
  const checked = validateProject(raw);
  if (!checked.ok) return { ok: false, message: checked.message };
  return { ok: true, project: checked.project };
}
