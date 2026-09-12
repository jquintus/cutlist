// Deployment constants. A fork changes this file and nothing else.

export const GITHUB_OWNER = 'jquintus';
export const GITHUB_REPO = 'cutlist';
export const GITHUB_BRANCH = 'main';

/**
 * Longest direct-upload URL we will hand to the browser before falling back to
 * a download.
 *
 * Measured against github.com on 2026-09-12: the prefilled new-file URL is
 * served normally up to roughly 6900 characters, errors somewhere past 7000,
 * and is refused outright with 414 above roughly 8200. This sits under the
 * first of those, so a link we hand out is a link that works.
 */
export const MAX_UPLOAD_URL_LEN = 6800;

/** Longest base64 share payload we will even attempt to inflate. */
export const MAX_HASH_B64 = 100000;

/** Largest inflated share payload we accept, as a zip-bomb guard. */
export const MAX_INFLATED_BYTES = 2000000;
