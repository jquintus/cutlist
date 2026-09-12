# cutlist

Turn a pile of sheet goods and a parts list into a cut plan you can read off a
phone at the saw, or print and tape to the wall.

Give it what plywood you have and what parts you need. It gives you back a
to-scale color diagram of each sheet, an ordered list of rips and crosscuts
with a measurement for every step, and a shopping list of the sheets you still
need to buy.

It is a static site. There is no build step, no server, and no account.

## The one hard rule: every cut goes edge to edge

Every layout this tool produces is guillotine cuttable. Every cut runs all the
way across the piece in front of you, so it is a cut you can actually make on a
table saw or with a track saw. There are no stopped cuts and no plunge cuts,
ever, even when a plunge cut would fit one more part on the sheet.

The packer is a heuristic. It is good, it is not optimal, and it does not know
about your defects, your grain, or the sheet that is already 3/8 in narrow on
one end. **Check every measurement against your own stock before you cut.**

## Opening a project

Open the site and pick a project from the list at the top, or paste a share
link. A share link carries the whole project in the URL itself, so it opens
with no network at all once the page has loaded once.

Three buttons cover the rest:

- **Copy share link** puts the current project in your clipboard as a URL.
- **Print cut list** gives you a black and white page that needs no color ink.
  The printed table and the on-screen diagram always describe the same layout.
- **Export JSON** saves the project as a file you can keep or mail to someone.

## Adding a project

Two ways, and neither one involves editing `projects/index.json`.

1. **Direct upload.** Build the project in the app, then press **Direct
   upload**. That opens GitHub's new-file page with the filename and contents
   already filled in, and you press Commit. For a project too large to fit in a
   URL it downloads the file instead, and you add it to `projects/` yourself.

2. **Drop a file in.** Put a `.json` file in `projects/` and commit it.

Either way, a GitHub Action regenerates `projects/index.json` on the next push
to `main`. **Never hand edit `projects/index.json`.** A pull request that
changes a project file without a matching regenerated index fails its check.

To regenerate the index locally:

```sh
node tools/build-index.mjs
```

## Running the tests

```sh
npm test
```

Plain `node --test`, no dependencies, no `node_modules`. The suite is where
the packer's guarantees live: no overlapping parts, everything inside the
usable sheet, a blade width between neighbors, every layout cuttable edge to
edge, and grain-locked parts never turned. The site runs without the tests;
the tests are how the layout is known to be safe to cut.

## Not in this round

Deferred to round 2, on purpose:

- Linear board stock. Anything milled from a board rather than cut from a
  sheet, such as the hardwood miter bars, is carried in the project file and
  listed as "not planned in this version" rather than laid out.
- The non-wood materials list: hardware, glue, finish.
- Any cost or price estimate.
