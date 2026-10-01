# Document Store — epic and child tickets

Tracker tickets for the Confluence Lite Space Document Store.

**These could not be filed automatically.** `scripts/ecm-issue.mjs` reads
`ECM_BASE_URL` plus `ECM_EMAIL`/`ECM_PASSWORD` from the environment, and all
four are unset in the development environment this work was done in. Each
ticket below carries a ready-to-run command; export the credentials and run
them, or paste the descriptions into the tracker by hand.

`JL-155` … `JL-163` are already in use. This work claims **JL-164 … JL-171**,
and those numbers appear in code comments and test filenames. If the tracker
assigns different ones, the references need rewriting rather than amending.

---

## JL-164 — EPIC: Document Store in Confluence Spaces

Give every Confluence Lite Space a Document Store: upload, organise, search,
preview, version and manage project and team documents, under the Space
permission model that already exists.

**Acceptance criteria**

1. Every Space has a Documents section.
2. Supported business and technical formats upload; executables are refused.
3. Per-file limit is 100 MB and is configurable without a code change.
4. Per-Space storage limit is configurable and enforced.
5. Documents can be filed into folders.
6. Documents can be searched and filtered.
7. Download is permission-gated.
8. Supported types preview; others say so plainly.
9. Versions are retained and restorable.
10. Metadata is in PostgreSQL; bytes are not.
11. Upload and download are audited.
12. Listings paginate.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Epic --priority High \
  --assignee sirisha@sedintechnologies.com \
  --title "Document Store in Confluence Spaces" \
  --description "Give every Confluence Lite Space a Document Store: upload, organise, search, preview, version and manage documents under the existing Space permission model. Metadata in PostgreSQL, bytes in the pluggable storage backend. Per-file cap 100 MB and per-Space quota, both configurable."
```

---

## JL-165 — Schema: documents, document_versions, document_folders

Three tables plus the Space quota columns. `documents.folder_id` is nullable
and `ON DELETE SET NULL` so losing a folder never destroys the documents in
it; `space_id` cascades, because a Space does own its documents.
`file_size` is `BIGINT`, since the cap is configurable and `INTEGER` tops out
at 2.1 GB.

Ship the `CREATE TABLE` **and** any `ALTER` an existing install needs — the
JL-157 lesson, where a `CREATE TABLE` said `NOT NULL` with no matching
migration and a fresh database was born broken.

**Acceptance criteria**: tables created on a fresh database and on an existing
one; a document with no folder is accepted; deleting a folder leaves its
documents unfiled rather than deleted; two versions cannot share a number.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Task --priority High \
  --assignee sirisha@sedintechnologies.com \
  --title "Document Store schema: documents, versions, folders" \
  --description "Add documents, document_versions and document_folders tables plus spaces.storage_limit_bytes and spaces.max_document_bytes. folder_id nullable and ON DELETE SET NULL; space_id cascades; file_size BIGINT. Unique version number per document. GIN index over file_name, description and tags for metadata search."
```

---

## JL-166 — Upload validation: allowlist, executable denylist, magic bytes

Extend the existing `validateUpload` rather than writing a second validator —
two would be two places for the executable denylist to drift apart. Add a
magic-byte sniff, because section 12 says never trust the extension alone and
multipart makes both the filename and the Content-Type client-supplied.

**Acceptance criteria**: every spec format uploads; `.exe/.bat/.cmd/.msi/
.scr/.com/.ps1/.vbs` are refused even when claiming an allowed MIME type; a
renamed executable is caught by its bytes; a real `.docx` is *not* rejected
for looking like a zip, which it legitimately is.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Task --priority High \
  --assignee sirisha@sedintechnologies.com \
  --title "Document upload validation: allowlist, executable denylist, magic bytes" \
  --description "Parameterise the shared validateUpload with the Document Store's wider extension and MIME allowlists and its larger cap. Add an always-on executable denylist and a magic-byte sniff so a renamed executable is caught. OOXML files are zips and must not be rejected for it."
```

---

## JL-167 — Multipart upload and streaming storage

Uploads are `multipart/form-data`, not base64-over-JSON: base64 inflates a
100 MB file to ~134 MB and would force the app's **global** `express.json`
limit up for every endpoint. Files land in a temp directory and stream into
the existing `getStorage()` backend; the temp file is removed on success, on
rejection, on abort and on error.

**Acceptance criteria**: a 100 MB file uploads without the global JSON limit
changing; the size cap is enforced by the parser, from configuration; the
temp file never leaks; the stored key is a UUID and never derived from the
uploaded filename.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Task --priority High \
  --assignee sirisha@sedintechnologies.com \
  --title "Multipart document upload with streaming storage" \
  --description "Accept documents as multipart/form-data with multer disk storage, enforcing the size cap in the parser from MAX_DOCUMENT_SIZE_MB. Stream the temp file into the storage backend via a new putStream, never buffering 100 MB on the heap. Clean up the temp file on every path. Existing attachment endpoints stay base64-over-JSON."
```

---

## JL-168 — Document API: list, read, update, delete, download, preview

Section 15's endpoints, permission-gated against the Space role and audited.
Listing paginates and narrows server-side. Downloads are served
`Content-Disposition: attachment` — an uploaded SVG or HTML rendered inline on
this origin executes with the app's cookies. Preview is a narrower, sandboxed
subset.

**Acceptance criteria**: a Space the caller cannot see is 404, not 403;
Viewer can view and download; Member can upload, replace and edit metadata;
Admin can move, delete and restore; listings paginate; downloads and previews
carry `nosniff`; preview refuses unsupported types with the spec's sentence.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Task --priority High \
  --assignee sirisha@sedintechnologies.com \
  --title "Document API: list, read, update, delete, download, preview" \
  --description "Implement section 15's document endpoints against the Space permission model (Viewer view/download, Member upload/replace/edit, Admin move/delete/restore). Paginated, filtered, audited. Downloads are Content-Disposition attachment with nosniff; preview is a narrower sandboxed subset excluding SVG."
```

---

## JL-169 — Folders and version history

Folders with breadcrumb navigation; replace writes a new version and never
overwrites; restore appends a higher version rather than rewinding, following
JL-108. Deleting a folder that still holds documents is refused, because
`folder_id` is `SET NULL` and the delete would silently unfile them instead.

**Acceptance criteria**: folders create, rename, move and delete; a folder
cannot be nested inside itself; version history lists every version; a
previous version downloads; restore produces a new highest version.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Task --priority Medium \
  --assignee sirisha@sedintechnologies.com \
  --title "Document folders and version history" \
  --description "Folder CRUD with cycle protection and a refusal to delete a folder that still holds documents. Replace appends a new version keeping the old storage key; restore appends rather than rewinding the counter (JL-108). Previous versions remain downloadable."
```

---

## JL-170 — Documents tab UI

A Documents tab on the Space view, with the listing, search and filters, the
upload dialog (drag and drop, multi-select, progress, cancel), storage usage,
and per-row actions. Upload uses `XMLHttpRequest`, because `fetch` cannot
report upload progress and section 4 requires a progress bar and a cancel
button.

**Acceptance criteria**: the tab appears on every Space; the 100 MB limit and
the supported formats are stated on screen; progress advances and cancel
aborts; server refusals are shown as sent; storage usage is displayed.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Story --priority High \
  --assignee sirisha@sedintechnologies.com \
  --title "Documents tab in the Confluence Space view" \
  --description "Add a Documents tab to /spaces/:key with a paginated table (Document, Type, Size, Uploaded by, Modified, Version, Actions), server-side search and filters, storage usage, and an upload dialog with drag-and-drop, multi-file selection, per-file progress and cancel via XMLHttpRequest. State the configured per-file limit and the supported formats on screen."
```

---

## JL-171 — Deferred: preview, malware scanning, OCR

Not built, recorded so the gaps are visible rather than assumed:

- **Office preview in the browser** — `.docx/.xlsx/.pptx` download rather than
  render. A real viewer needs either a conversion service or a third-party
  embed, which is a procurement decision, not a coding one.
- **Real malware scanning** — `services/virusScan.js` is a documented hook
  that catches the EICAR test signature and allows everything else. Only the
  first 8 KB is scanned; a clamd integration would stream the whole file.
- **OCR, content indexing, expiry notifications** — section 8 asks only for
  metadata search today; document *content* search is a separate build.

```bash
node scripts/ecm-issue.mjs create --project 6 --type Task --priority Low \
  --assignee sirisha@sedintechnologies.com \
  --title "Document Store: Office preview, real malware scanning, OCR" \
  --description "Deferred from the Document Store epic. Office formats download rather than preview (needs a conversion service or embed). virusScan.js remains a hook scanning only the first 8KB; wire clamd for real scanning. OCR, full document-content indexing and expiry notifications are not built."
```
