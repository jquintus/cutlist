// Regenerates the import map in index.html with a content hash per module.
//
// GitHub Pages serves every file with cache-control: max-age=14400, and a
// plain ES module graph asks for each file by a URL that never changes. So a
// browser that visited before a deploy keeps running yesterday's modules
// against today's index.html. That is not theoretical: removing the Print
// button shipped an index.html with no btn-print while browsers still held an
// app.js that wired one, which threw on startup and left the whole page dead.
//
// The fix is to give every module a URL that changes when its bytes change.
// An import map lets that happen without a bundler: the relative specifier in
// the source stays as it is, and the map redirects the resolved URL to the
// hashed one. Run by the deploy workflow, never by hand.
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const START = '<script type="importmap">';
const END = '</script>';

async function moduleFiles(dir) {
  const found = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await moduleFiles(path)));
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) found.push(path);
  }
  return found;
}

const files = [...(await moduleFiles('src')), ...(await moduleFiles('vendor'))].sort();

async function hashOf(file) {
  const bytes = await readFile(join(ROOT, file));
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

const imports = {};
for (const file of files) {
  const bytes = await readFile(join(ROOT, file));
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const url = `./${file.split('\\').join('/')}`;
  imports[url] = `${url}?v=${hash}`;
}

const map = `${START}\n${JSON.stringify({ imports }, null, 2)}\n${END}`;

const htmlPath = join(ROOT, 'index.html');
let html = await readFile(htmlPath, 'utf8');

const from = html.indexOf(START);
if (from === -1) {
  // First run: put the map immediately before the entry script, which has to
  // resolve through it.
  html = html.replace(
    /<script type="module" src="[^"]*"><\/script>/,
    (entry) => `${map}\n${entry}`,
  );
} else {
  html = html.slice(0, from) + map + html.slice(html.indexOf(END, from) + END.length);
}

// Stylesheets are not modules and never pass through the import map, so their
// <link> hrefs are hashed directly. Leaving them unhashed is not a smaller
// version of the same bug, it is the same bug: a CSS-only change then ships an
// index.html that browsers pair with yesterday's stylesheet for four hours.
for (const sheet of ['styles/app.css', 'styles/print.css']) {
  const hash = await hashOf(sheet);
  const escaped = sheet.replace(/[/.]/g, (ch) => `\\${ch}`);
  html = html.replace(
    new RegExp(`href="${escaped}(?:\\?v=[0-9a-f]+)?"`),
    `href="${sheet}?v=${hash}"`,
  );
}

// The entry point is not reached through the import map, since nothing imports
// it, so it carries its own hash directly.
const entryHash = imports['./src/ui/app.js'].split('?v=')[1];
html = html.replace(
  /<script type="module" src="src\/ui\/app\.js(?:\?v=[0-9a-f]+)?"><\/script>/,
  `<script type="module" src="src/ui/app.js?v=${entryHash}"></script>`,
);

await writeFile(htmlPath, html);
console.log(`import map: ${files.length} modules hashed`);
