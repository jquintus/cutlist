# Vendored dependencies

Nothing here is edited. Everything here is copied verbatim from a published
package so the site has no runtime dependency on a CDN. A share link has to
open on a phone with bad signal at the back of a shop, which rules out
fetching a compression library at page load.

## pako.esm.min.mjs

- Package: `pako`
- Version: `3.0.2`
- License: MIT, Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn
- Source path inside the tarball: `package/dist/browser/pako.esm.min.mjs`
- Tarball integrity: `sha512-uBv6IT2aT1A78iU6dpNEbf6+CyhlV/6g9JlJs9kpgjFGFhruIICVRysF/W0SLzXg5+hCl+KroH7e4YUyfEmgLg==`
- Named exports used: `deflate`, `inflate`

To refresh it:

```sh
npm pack pako@3.0.2
tar xzf pako-3.0.2.tgz
cp package/dist/browser/pako.esm.min.mjs vendor/pako.esm.min.mjs
```

Confirm the integrity line printed by `npm pack` matches the one above before
copying anything into place.

Note on pako 3: `inflate(bytes, { to: 'string' })` does not return a string.
That option was removed in pako 3 and the call quietly returns a `Uint8Array`
instead, which then fails inside `JSON.parse` with a confusing message. Encode
with `TextEncoder` before deflating and decode with `TextDecoder` after
inflating. `src/share/codec.js` does exactly that.
