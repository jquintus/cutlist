# cutlist

Turn a pile of sheet goods and a parts list into a cut plan you can read off a
phone at the saw, or print and tape to the wall.

Give it what plywood you have and what parts you need. It gives you back a
to-scale color diagram of each sheet, an ordered list of rips and crosscuts
with a measurement for every step, and one shopping list for sheets and other
project supplies you still need to buy.

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

Open the site and you get a home page with a new-project button, the projects
committed to this repository, and the Storage library. A share link carries
the whole project in the URL itself, so it opens with no network at all once
the page has loaded once.

Projects:

- **New project** starts an empty project.
- **Open project...** lists the projects committed to this repository.

Nothing is saved in your browser. A project lives in the URL, in a file you
export, or in `projects/` in this repository, all three of which can reach
another device. That is the point: build the plan at a desk, open it on a phone
at the saw.

The rest of the menu:

- **Use stock library...** copies selected offcuts from `projects/storage.json`
  into the current project. The copy is a snapshot, so later library changes
  cannot change an existing cut plan or share link.
- **Copy share link** puts the current project in your clipboard as a URL.
- **Export JSON** saves the project as a file you can keep or mail to someone.
- **Import JSON** reads such a file back.
- **Save to GitHub** is a plain link to a prefilled commit page; see below.

The stock library uses the same material and stock rows as any project. Enter
only the sheets and boards physically in the shop. When imported stock runs
out, a project uses a standard 48 x 96 sheet or 8 ft board as its initial
purchase size; it can be changed in that project. `projects/storage.json` is
marked with `library: true`, which keeps it in the Storage section instead of
the ordinary project list.

For quick inventory edits on a phone, use **Edit inventory** on the home page.
It opens the protected Storage form in [Pages CMS](https://app.pagescms.org/).
The form is configured by `.pages.yml`; Pages CMS commits changes to GitHub,
and the ordinary project-index workflow publishes them with the site.

There is no Print button. Use your browser's own print command (Ctrl/Cmd+P),
which is also how you get a PDF: choose "Save as PDF" as the destination. The
print stylesheet gives you a black and white page that needs no color ink, with
each sheet's diagram beside its CUTS list and its parts checklist, and the
checkboxes printed as empty boxes to tick with a pencil. Nothing on paper
depends on color to be understood. The printed page and the on-screen diagram
always describe the same layout.

## Working at the saw

Every sheet heading is a link to that sheet on its own: its diagram, its cuts,
its parts, and nothing else on the screen. **Prev** and **Next** step through
the sheets from there. The **Shopping list** heading opens the same way, for
standing in a store working down the list.

Ticking a part or a shopping line records it in the URL, so a refresh does not
lose what you have already cut or bought.

## Adding a project

Two ways, and neither one involves editing `projects/index.json`.

1. **Save to GitHub.** Build the project in the app, then follow **Save to
   GitHub** in the menu. It is an ordinary link: it points at GitHub's new-file
   page with the filename and contents already filled in, and you press Commit.
   Open it in a new tab, copy it, or check where it goes before you click, the
   way you would any link. For a project too large to fit in a URL the link
   becomes a download of the file instead, and you add it to `projects/`
   yourself.

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

## Running locally

```bash
python3 -m http.server 9180
```
