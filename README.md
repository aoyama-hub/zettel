# Zettel

A small, grayscale Zettelkasten web app. It's a static site with no backend and no accounts. Notes are markdown files in a separate GitHub repo, read and written through the GitHub REST API with a fine-grained personal access token.

## Setup

1. **Create the notes repo** (private is best), for example `you/notes`. It can be empty. The app creates `fleeting/`, `literature/`, and `permanent/` as notes are saved.
2. **Create a fine-grained token** at GitHub → Settings → Developer settings → Fine-grained tokens:
   - Repository access: *Only select repositories* → your notes repo
   - Permissions: **Contents: Read and write** (Metadata: read is added automatically)
3. **Deploy this app repo** to GitHub Pages: push these files, then Settings → Pages → *Deploy from a branch* → `main` / root.
4. Open the Pages URL on your phone and enter the token, owner, repo, and branch. They're stored in this browser's `localStorage`, so you only enter them once per browser (or per installed app). Settings is at the bottom of the notes list if you need to change them.
5. Optional: install it. On iPhone use Share → Add to Home Screen, in Safari on Mac use File → Add to Dock, and in Chrome use Install page as app. It opens straight to capture.

Local development needs any static server (ES modules don't load from `file://`):

```bash
python3 -m http.server 8000
```

## Note format

```yaml
---
title: Notes compound over time     # permanent notes only
type: permanent                     # fleeting | literature | permanent
source: Thinking, Fast and Slow     # literature notes only
references: ["Thinking, Fast and Slow"] # permanent (and fleeting) notes: connected references
created_at: 2026-09-13T14:17:10.346Z
links: [Alpha, Beta]
---
Body in markdown with [[Alpha]] style links.
```

- `title` is an addition to the spec. Filenames are slugified, so they can't hold the real title. Notes without `title` (for example files imported from Obsidian) use the filename as their title.
- `links` is rewritten from the body's `[[wikilinks]]` on every save. Backlinks read both `links` and in-body wikilinks.
- Frontmatter keys the app doesn't know about (`aliases`, `tags`, …) are kept as they are.
- Captures are named `YYYYMMDD-HHmmss.md`. Permanent notes are named `slugified-title.md`. If you change a title, the file is renamed when you leave the editor. That takes two commits: create the new file, then delete the old one.
- `archived: true`: for fleeting notes it's set by the 7-day cleanup (with `archived_at`); for literature notes it means "already made permanent".
- **Safety**: the app never deletes literature or permanent notes on its own. Every automatic removal path, in both the note store and the GitHub API layer, refuses any file outside `fleeting/`. Permanent notes (editor **Delete**) and literature notes (**Delete** under each note on its reference page) can only be deleted by you, one at a time, after confirming.

## Behaviour notes

- **Capture**: tapping *New* saves the text to a local outbox right away, clears the box, and commits in the background. If a commit fails (offline, bad token), the note stays in the outbox. The app retries on the next capture, when the network comes back, or when the app becomes visible again. Tap the status text to retry now. The source field is cleared after each note, so the next note doesn't silently become a literature note.
- **Screens**: the app opens on the lists, with **Fleeting**, **Permanent** and **References** across the top. A bottom bar holds three things: **Review** (card stack, badged with how many notes are due), **Capture** (the shutter button, which opens the capture screen) and **Settings** (which holds the Archive and the GitHub connection). Tapping the icon of the screen you're already on returns to the notes. The search bar matches titles and note text; for a match in the text, the result line shows the matching passage. Permanent notes and references can be ordered **A–Z** or **Recent** (by last edit; saving a permanent note records `updated_at`).
- **Fleeting tab**: fleeting notes grouped under small date labels by last edit, newest first. Every row is the same height: two lines, ending in "…" when the note is longer. Tap one to turn it into a permanent note: it opens prefilled with the fleeting text and its references. Give it a title and rewrite it. When you tap **Done** or leave the note, and it has saved with a title, the fleeting original is deleted. A literature original is never deleted: it's marked processed and stays in References.
- **Review**: a shuffled run through every permanent note, one card at a time. Drag a card: a SKIP or CONNECT stamp fades in to show what the gesture will do. Left (or ←) moves on; right (or →) opens capture with a `[[link]]` to that note already written, so the new note starts connected. Tapping a card opens the note. The order is kept until the last card, so a run can be resumed later; only then is a new order drawn, which is when notes added since the last shuffle join in. Each decision records `reviewed_at` and `updated_at` (so reviewing counts as touching a note), and `skipped` counts rejections since the last connection (a connection resets it to 0). Swipes are batched into a single commit a few seconds later, or when you leave the screen. The **Review** icon is badged with the number of permanent notes never reviewed or not reviewed in the last 7 days.
- **Export**: on the Permanent tab, **Export** downloads one `.txt` with every permanent note in the current order. It opens with a prompt (in `js/download.js`) asking the AI to find emergent connections across the notes in two passes: analysis, then candidate permanent notes in your style, split into solid (Tier 1) and stretch (Tier 2) findings. Formatting is kept minimal to save tokens: each note follows a bare `---` line and is its title, a line with its creation date (and references, if any), then its text. Divider lines (`---`) inside a note are exported as `***` so they can't be mistaken for the separator. On iPhone it opens the share sheet, so you can save to Files.
- **Fleeting lifecycle**: a background cleanup runs at most every 6 hours and makes a single commit. Fleeting notes older than 7 days are marked `archived: true` and move to **Archive**, where you can still make them permanent. Fleeting notes unchanged for 90 days are deleted. Before a deletion, the file's git history is checked, and an edit made elsewhere (for example in Obsidian) is recorded as `updated_at`, which resets the clock. Only files in `fleeting/` tagged `type: fleeting` are ever considered.
- **References**: a reference is any source text: a book, article, interview, post, or URL. Its page lists its literature notes in the same two-line, date-grouped rows as the Fleeting tab (tap one to read it in full or delete it), then the permanent notes connected to it. The capture screen's Source field and the editor suggest references you've used before, so notes on the same source stay together.
- **Connecting permanent notes to references**: a permanent note's references are stored in its `references` frontmatter list and shown under its title. Connect from either side: on a reference page, **+ Connect** searches your permanent notes and × disconnects one; while editing a note, **+ Reference** adds one and × removes it. A note's **Linked notes** strip lists its references, other notes that share a reference, and `[[links]]` in both directions. Promotion carries them over (a literature note's source, or a fleeting note's `references`), so rewriting the text can't lose the connection. Older notes that name their source in a `Source: …` body line count as connected too. Export lists them after the date line under each note's title.
- **Reading**: existing notes open rendered, with headings, lists, tasks, quotes, code, tables, and links. `[[Links]]` are tappable, and links to notes that don't exist yet are dotted and create the note. Task checkboxes can be ticked while reading.
- **Editing**: tap anywhere in a note to edit it; the cursor lands where you tapped. Tap the title to edit the title. **Done** (or Esc) goes back to reading. On phones a toolbar above the keyboard inserts `[[ ]]`, headings, lists, and tasks. Enter continues a list, and Enter on an empty item ends it. On desktop, `e` starts editing and Cmd/Ctrl+S saves.
- **Saving**: autosaves after 4 s of idle time, and right away on Done, on leaving the note, or when the page is hidden. Unsaved edits are also kept on the device and restored if the tab is killed before a commit lands. If the file was changed on another device, the status shows *Changed on another device. Tap to overwrite.*
- **Export** copies markdown to the clipboard with no network calls. Neighbours are counted in both directions: notes this one links to, plus notes that link to it.
- **Index**: the app lists the repo tree, then loads note contents in batches of 100 through the GraphQL API (falling back to one REST call per note), and caches them in IndexedDB by blob sha. A 2,000-note vault takes about 20 requests on first load. Later loads only fetch notes that changed.
- **Offline**: a service worker keeps the app's own files. The app opens without a connection, and captures wait in the outbox. It always revalidates, so a new deploy is picked up on the next load.

## Security

The token sits in `localStorage`, so anyone who can run JavaScript on this origin can read it. To keep that surface small, the app has no third-party scripts (plain `fetch`, no Octokit or CDN). A Content-Security-Policy limits scripts to this origin and network calls to `api.github.com`. Rendered markdown is built as DOM nodes, never HTML strings, and only `http(s)`/`mailto` links are clickable. Images from `https:` URLs are shown in grayscale. Scope the token to the notes repo only.

## Not built

No login, speech-to-text, spaced repetition, graph view, tags, or LLM calls. Renaming a note doesn't update `[[links]]` in other notes that point to the old title.
