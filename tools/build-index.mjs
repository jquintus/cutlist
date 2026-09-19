#!/usr/bin/env node
// Regenerate projects/index.json from the project files beside it.
//
// Output is deterministic on purpose: no timestamp, fixed key order, sorted by
// file name. The pull request job runs this and then checks that nothing
// changed, which only works if two runs over the same inputs produce the same
// bytes.
//
// Zero dependencies. Nothing installs to run this.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECTS_DIR = join(ROOT, 'projects');
const INDEX_FILE = join(PROJECTS_DIR, 'index.json');

function summarize(file, project) {
  return {
    file,
    slug: file.replace(/\.json$/, ''),
    name: typeof project.name === 'string' ? project.name : '',
    date: typeof project.date === 'string' ? project.date : '',
    notes: typeof project.notes === 'string' ? project.notes : '',
    materialCount: Array.isArray(project.materials) ? project.materials.length : 0,
    partCount: Array.isArray(project.parts) ? project.parts.length : 0,
    unplannedCount: Array.isArray(project.unplanned) ? project.unplanned.length : 0,
  };
}

async function main() {
  const entries = await readdir(PROJECTS_DIR);
  const files = entries.filter((name) => name.endsWith('.json') && name !== 'index.json').sort();

  const projects = [];
  for (const file of files) {
    const text = await readFile(join(PROJECTS_DIR, file), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      // Name the file. A stack trace pointing at JSON.parse is useless here.
      console.error(`projects/${file} is not valid JSON: ${error.message}`);
      process.exit(1);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error(`projects/${file} is not a project object.`);
      process.exit(1);
    }
    projects.push(summarize(file, parsed));
  }

  const index = { schemaVersion: 2, projects };
  await writeFile(INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote projects/index.json with ${projects.length} project(s).`);
}

await main();
