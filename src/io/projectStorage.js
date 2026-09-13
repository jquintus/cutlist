// Projects saved in this browser.
//
// SECURITY: everything that comes back out of storage is untrusted, exactly
// like a file someone imported or a share link someone opened. Another page on
// this origin, an extension, or an older build of this app could have written
// it. So a stored project goes back through validateProject() on every read
// and is never assigned to the live project directly. A write runs the same
// chain before it stores anything, so what Save accepts and what Open returns
// cannot drift apart. Nothing here stores a credential or anything personal: a
// project is sheet sizes and part names.
//
// The storage object is injected rather than reached for, so this module is a
// plain function of its argument and runs under node --test with a plain
// object standing in for localStorage.

import { validateProject } from './validate.js';
import { stampForSave } from '../model.js';
import { slugify } from '../share/upload.js';

const PROJECTS_KEY = 'cutlist.projects.v1';
const LAST_OPENED_KEY = 'cutlist.lastOpened';

/**
 * The browser's own storage, or a stand-in that holds nothing.
 *
 * Reading `localStorage` is itself what throws when a browser has storage
 * switched off, so even the lookup goes in a try. Without this the module
 * would throw while loading and take the whole app down with it, on exactly
 * the setup least able to recover: a locked-down phone at the back of a shop.
 */
function defaultStorage() {
  try {
    if (globalThis.localStorage) return globalThis.localStorage;
  } catch {
    // Storage is switched off. Fall through to the stand-in.
  }
  return {
    getItem: () => null,
    setItem() { throw new Error('storage unavailable'); },
    removeItem() {},
  };
}

/**
 * Make a storage facade over one Storage-shaped object.
 *
 * Every call is wrapped: a private window throws on read and on write, storage
 * can be full, and another page on this origin can leave unparseable text
 * behind. None of that may stop someone opening a share link at the back of a
 * shop, so a failure always degrades to "there is nothing saved here" rather
 * than to an exception.
 */
export function createProjectStorage(storage = defaultStorage()) {
  function readAll() {
    try {
      const raw = storage.getItem(PROJECTS_KEY);
      if (typeof raw !== 'string' || raw === '') return {};
      const parsed = JSON.parse(raw);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeAll(entries) {
    try {
      storage.setItem(PROJECTS_KEY, JSON.stringify(entries));
      return true;
    } catch {
      return false;
    }
  }

  return {
    /** Every save that still validates, newest name first by slug order. */
    list() {
      const entries = readAll();
      return Object.keys(entries).sort().flatMap((slug) => {
        const checked = validateProject(entries[slug]);
        if (!checked.ok) return [];
        return [{ slug, name: checked.project.name || slug, date: checked.project.date }];
      });
    },

    /** One save, revalidated. Returns { ok, project } or { ok: false, message }. */
    read(slug) {
      const entry = readAll()[slug];
      if (entry === undefined) return { ok: false, message: 'There is no project saved under that name.' };
      const checked = validateProject(entry);
      if (!checked.ok) return { ok: false, message: checked.message };
      return { ok: true, project: checked.project };
    },

    /**
     * Save under `slug`, stamped the way an export is stamped so a local save
     * and a committed file carry the same metadata.
     *
     * Save and Open have to agree about what counts as a project. Open drops a
     * stored entry that no longer validates, so a save that skipped this check
     * reported success and then vanished from Open with the work gone and no
     * error anywhere. The app can be walked into that state -- a part added
     * before any material group exists, or a group deleted out from under its
     * parts -- so the check is run on exactly the bytes about to be written,
     * and a refusal says why while the project stays on screen to be fixed.
     */
    write(slug, project) {
      const stamped = stampForSave(project);
      const checked = validateProject(stamped);
      if (!checked.ok) return { ok: false, field: checked.field, message: `Not saved. ${checked.message}` };
      const entries = readAll();
      entries[slug] = stamped;
      if (!writeAll(entries)) {
        return { ok: false, message: 'This browser would not save the project. It may be in private mode.' };
      }
      return { ok: true, project: stamped };
    },

    remove(slug) {
      const entries = readAll();
      if (!(slug in entries)) return { ok: true };
      delete entries[slug];
      return writeAll(entries)
        ? { ok: true }
        : { ok: false, message: 'This browser would not update its saved projects.' };
    },

    lastOpened() {
      try {
        const value = storage.getItem(LAST_OPENED_KEY);
        return typeof value === 'string' && value !== '' ? value : null;
      } catch {
        return null;
      }
    },

    setLastOpened(slug) {
      try {
        storage.setItem(LAST_OPENED_KEY, slug);
      } catch {
        // Remembering which project was last open is a convenience, never a
        // requirement. Losing it costs one click.
      }
    },
  };
}

/** The storage key a project name saves under. Same slug rule as an export. */
export function slugFor(name) {
  return slugify(name);
}
