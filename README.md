# Zettel

A small, grayscale Zettelkasten web app. It's a static site with no backend and no accounts. Notes are markdown files in a separate GitHub repo, read and written through the GitHub REST API with a fine-grained personal access token.

## Setup

1. **Create the notes repo** (private is best), for example `you/notes`. It can be empty. The app creates `fleeting/`, `literature/`, and `permanent/` as notes are saved.
2. **Create a fine-grained token** at GitHub → Settings → Developer settings → Fine-grained tokens:
   - Repository access: *Only select repositories* → your notes repo
   - Permissions: **Contents: Read and write** (Metadata: read is added automatically)
3. **Deploy this app repo** to GitHub Pages: push these files, then Settings → Pages → *Deploy from a branch* → `main` / root.
4. Open the Pages URL on your phone and enter the token, owner, repo, and branch. They're stored in this browser's `localStorage`. Settings is at the bottom of the notes list if you need to change them.

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
created_at: 2026-09-13T14:17:10.346Z
links: [Alpha, Beta]
---
Body in markdown with [[Alpha]] style links.
```

- `title` is an addition to the spec. Filenames are slugified, so they can't hold the real title. Notes without `title` (for example files imported from Obsidian) use the filename as their title.
- `links` is rewritten from the body's `[[wikilinks]]` on every save. Backlinks read both `links` and in-body wikilinks.
- Frontmatter keys the app doesn't know about (`aliases`, `tags`, …) are kept as they are.
- Captures are named `YYYYMMDD-HHmmss.md`. Permanent notes are named `slugified-title.md`. If you change a title, the file is renamed when you leave the editor. That takes two commits: create the new file, then delete the old one.
- **Archive source** adds `archived: true` to a fleeting or literature note, which hides it from the Unprocessed list. The file stays in its folder.

## Behaviour notes

- **Capture**: tapping *New* saves the text to a local outbox right away, clears the box, and commits in the background. If a commit fails (offline, bad token), the note stays in the outbox. The app retries on the next capture, when the network comes back, or when the app becomes visible again. Tap the status text to retry now. The source field is cleared after each note, so the next note doesn't silently become a literature note.
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
