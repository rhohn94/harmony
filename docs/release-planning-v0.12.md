# Release Planning — v0.12

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.12.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.12` |
| **Previous** | `v0.11` (Quarry — links-only download search) |
| **Theme** | "Curator" — curate your library: add games directly, enrich them automatically with cover art + Wikipedia, seed ROM-site download providers, and explore the entire console landscape with a full bundled title catalog. |

Four user-requested capabilities built atop the existing library, metadata, and
links-only search domains. Library entries stay **import-backed** (every row is a
real ROM file); download providers stay **links-only** (no fetch, no bundled game
content); the bundled console catalog ships **titles only** (community
libretro-database names, freely redistributable). Designs:
[`library-import-design.md`](design/library-import-design.md),
[`console-browse-design.md`](design/console-browse-design.md).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W121** | Add to library + auto-metadata | Migration 005 adds `games.description` + `games.wikipedia_url`; a new Wikipedia client fetches a summary + article URL; `enrich_game_metadata` pulls cover art + Wikipedia best-effort; the detail page shows the description, a "Refresh metadata" action, and a Wikipedia link. A miss degrades silently. |
| **W122** | ROM-site download providers | Migration 005 seeds a curated set of emulator/ROM sites as `kind='download'` providers, each a links-only `https://…{query}` template (probed to resolve). The no-fetch / no-bundled-content contract is preserved. |
| **W123** | Import via drag-drop or file picker | A ROM can be imported by drag-and-drop (Tauri webview drag-drop) or the native file dialog (`tauri-plugin-dialog`); the file is identified by extension, copied to `<games_dir>/<system>/`, registered, and made launchable. Import is idempotent (dedup by content hash) and never clobbers a distinct same-named file. |
| **W124** | By-Console view + full title catalog | A static catalog of 20 consoles (name/maker/generation/year) with cached Wikipedia photo + description; `/consoles` browses them (generation-grouped, searchable) and `/console/:key` shows owned games plus the console's **entire** known catalog — ~28.6k titles across all 20 consoles, generated from libretro-database datfiles (names only) and embedded with `include_dir!`, browsable + paginated + ownership-flagged. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Each feature extends an existing domain:
import reuses the library repo + scan mapper, enrichment reuses the cover-art
fetcher and adds a Wikipedia client, the download seeds reuse the v0.11 provider
`kind` machinery, and the console views add a new `core/console` domain (static
catalog + bundled title catalog + media cache). The bundled catalog is generated
offline by `scripts/build-console-catalog.mjs` and committed as
`src-tauri/resources/catalog/*.json`. Each item committed atomically; full gates
(typecheck/lint/clippy/test/build/smoke) before merge. A multi-agent adversarial
review ran over the full diff; one genuine import-idempotency bug was caught and
fixed (dedup by content hash, not destination path).

## 4. Out of scope

- Auto-downloading or scraping ROMs — the links-only contract is unchanged;
  Harmony only opens a `{query}` link in the user's own browser.
- Bundling game content — the console catalog ships **names only**, never ROMs
  or copyrighted assets.
- Library entries without a backing file — every library row remains
  import-backed (no metadata-only / wishlist entries).
- Per-console box-art packs or screenshot galleries beyond the single cached
  Wikipedia photo.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W121 — add to library + auto-metadata | version/0.12 (in-session) | ☑ | migration 005 adds `description`/`wikipedia_url`; `core/metadata/wikipedia.rs` client; `enrich_game_metadata` fetches art + summary best-effort; GameDetailPage shows description + Refresh + Wikipedia link. |
| W122 — ROM-site download providers | version/0.12 (in-session) | ☑ | migration 005 seeds curated `kind='download'` links-only providers (probed to resolve); no-fetch contract preserved + tested (`downloads >= 6`). |
| W123 — import via drag-drop or picker | version/0.12 (in-session) | ☑ | `core/library/import.rs` identify→hash→dedup-by-content→place→register; `tauri-plugin-dialog` picker + webview drag-drop; idempotent + never-clobber, tested. |
| W124 — by-console view + title catalog | version/0.12 (in-session) | ☑ | `core/console` (catalog/titles/media); 28,577 titles across 20 consoles embedded via `include_dir!`; `/consoles` + `/console/:key`; ownership via normalized title match. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.12 → dev | ☑ | merged `--no-ff`; 237 Rust + 65 JS tests green on dev |
| dev → main promoted + tagged v0.12 | ☑ | |
| deployed | ☑ | /Applications/Harmony.app + deployed-apps/current at 0.12.0 |
| pushed to origin | ☑ | main + dev + tag v0.12 (fast-forward, no force) |
