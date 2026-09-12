// Share-link codec.
//
// The whole project is deflated, base64url encoded and carried in the URL
// fragment, so restoring a shared plan needs no server round trip at all.
//
// The fragment is attacker controllable: anyone can send someone a link. It
// is size capped before it is inflated, size capped again after, and then run
// through the same validation chain a file import uses. Nothing here parses
// straight into live state.

import { deflate as pakoDeflate, inflate as pakoInflate } from '../../vendor/pako.esm.min.mjs';
import { MAX_HASH_B64, MAX_INFLATED_BYTES } from '../config.js';
import { validateProject } from '../io/validate.js';

/** Marks the payload as ours and as this codec. An unmarked fragment is refused outright. */
export const HASH_PREFIX = 'pako:';

// btoa throws a RangeError once the argument list passes roughly 100 KB, and
// a real project reaches that, so the binary string is built in chunks.
const CHUNK = 0x8000;

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Encode a project for the URL fragment.
 *
 * `deflate` is injectable so the compression library can be exercised or
 * stubbed in a test; production always uses the vendored pako.
 */
export function encodeProject(project, { deflate = pakoDeflate } = {}) {
  const json = JSON.stringify(project);
  const bytes = new TextEncoder().encode(json);
  return HASH_PREFIX + bytesToBase64Url(deflate(bytes, { level: 9 }));
}

/**
 * Decode a URL fragment back into a validated project.
 *
 * Returns { ok: true, project } or { ok: false, error }. Never throws, because
 * a malformed fragment is an everyday event (a truncated link in a text
 * message) and must not take the page down.
 */
export function decodeHash(hash, { inflate = pakoInflate } = {}) {
  const raw = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  if (raw === '') {
    return { ok: false, error: 'There is no shared project in this link.' };
  }
  if (!raw.startsWith(HASH_PREFIX)) {
    return { ok: false, error: 'This link does not carry a cutlist project.' };
  }

  const payload = raw.slice(HASH_PREFIX.length);
  // Capped before anything is decompressed, so an oversized link costs nothing.
  if (payload.length > MAX_HASH_B64) {
    return { ok: false, error: `That shared project is too large to open (${payload.length} characters, limit ${MAX_HASH_B64}).` };
  }

  let bytes;
  try {
    bytes = base64UrlToBytes(payload);
  } catch {
    return { ok: false, error: 'That link is damaged: the shared project is not valid base64.' };
  }

  let inflated;
  try {
    inflated = inflate(bytes);
  } catch {
    return { ok: false, error: 'That link is damaged: the shared project could not be decompressed.' };
  }
  if (!(inflated instanceof Uint8Array)) {
    return { ok: false, error: 'That link is damaged: the shared project did not decompress to data.' };
  }
  if (inflated.length > MAX_INFLATED_BYTES) {
    return { ok: false, error: `That shared project expands to ${inflated.length} bytes, past the ${MAX_INFLATED_BYTES} byte limit.` };
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(inflated));
  } catch {
    return { ok: false, error: 'That link is damaged: the shared project is not valid JSON.' };
  }

  const checked = validateProject(parsed);
  if (!checked.ok) return { ok: false, error: checked.message };
  return { ok: true, project: checked.project };
}
