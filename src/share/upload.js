// Direct upload to the project repository.
//
// GitHub's "new file" page accepts a prefilled filename and body in the query
// string, which turns adding a project into one commit button. Long URLs get
// dropped by browsers and proxies, so past a size limit this hands back a
// plain file download instead and lets the caller save it.

import {
  GITHUB_OWNER,
  GITHUB_REPO,
  GITHUB_BRANCH,
  MAX_UPLOAD_URL_LEN,
} from '../config.js';
import { stampForSave } from '../model.js';

/** A file-safe name from a project title. */
export function slugify(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'project' : slug;
}

/** The exact JSON written to projects/, pretty printed so a diff is readable. */
export function projectJson(project) {
  return `${JSON.stringify(project, null, 2)}\n`;
}

/**
 * The same project as the smallest JSON that still parses.
 *
 * Percent encoding charges three characters for every newline and every space
 * of indentation, so a pretty printed body roughly doubles in the URL and puts
 * even a modest real project past what github.com will serve. The download
 * body stays pretty printed; only the prefilled editor gets this form, and the
 * editor is where a person reformats before committing anyway.
 */
export function urlBodyJson(project) {
  return JSON.stringify(project);
}

/**
 * Where to send someone who wants this project committed to the repository.
 *
 * Returns { kind: 'url', url, filename } when the prefilled page will fit in a
 * URL, and { kind: 'download', filename, json } when it will not.
 *
 * Stamps the same schemaVersion/date metadata a manual export stamps, so a
 * project committed this way is indistinguishable, in the shared project
 * list, from one saved through Export. `now` is injectable for tests.
 */
export function directUpload(project, { now } = {}) {
  const stamped = stampForSave(project, now ? { now } : {});
  const filename = `${slugify(stamped.name)}.json`;
  const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/new/${GITHUB_BRANCH}`
    + `?filename=projects/${encodeURIComponent(filename)}`
    + `&value=${encodeURIComponent(urlBodyJson(stamped))}`;

  if (url.length > MAX_UPLOAD_URL_LEN) {
    return { kind: 'download', filename, json: projectJson(stamped) };
  }
  return { kind: 'url', url, filename };
}
