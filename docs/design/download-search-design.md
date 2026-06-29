# Download Search — Design

> **Up:** [↑ Docs](../README.md) · **Sib:** [file-search](file-search-design.md),
> [interaction-wiring](interaction-wiring-design.md)

## 1. Goal

Help the user **find downloadable games** from the search screen and from a
game's detail page. v0.6/v0.11 surfaced provider *links*; **v0.16 "Trove"**
surfaces a **preview of what each provider found**, so the user can scan
candidate files in-app and open the one they want in their browser.

## 2. The contract (what is and isn't allowed)

The invariant that matters is unchanged and non-negotiable: **Harmony ships no
game content and never downloads content for the user.** It surfaces results;
the user opens their chosen link in their own browser and decides what (if
anything) to download.

**Evolved in v0.16:** to *preview* what a provider found, the backend now
**fetches each provider's public search-results page and scrapes the candidate
links from its HTML** (`core/search/fetch.rs`). This deliberately supersedes the
earlier "never fetch the target URL server-side" rule from
[file-search-design.md](file-search-design.md) §2 — that rule predated the
preview feature. What is fetched is only the provider's **search-results page**
(metadata about what's available); the content files themselves are never
fetched or stored by Harmony.

Safeguards bound the new fetch (`fetch.rs`):

| Guard | Value | Why |
|---|---|---|
| Scheme allow-list | `http` / `https` only | never `file:`, `data:`, etc. |
| Per-request timeout | 8 s | a slow provider degrades to "no preview", never hangs |
| Response body cap | 2 MiB (enforced while reading) | a huge page can't exhaust memory |
| Result cap | 30 links / provider | bounds response + UI |
| Title length cap | 200 chars | bounds anchor-text size |
| Concurrency | one scoped thread per provider | total latency ≈ slowest single fetch |

A per-provider fetch/parse failure surfaces as that group's `error` and never
fails the whole search; the provider's constructed `searchUrl` is always offered
as a browser fallback.

## 3. Provider kinds (unchanged)

Search providers carry a `kind`: `"reference"` (metadata/info) or `"download"`.
User-added providers default to `"reference"`; the legal download sources
(Internet Archive, itch.io) are seeded `"download"` (migration 004). Only
**legal** homes for public-domain / homebrew / freely-distributable content are
seeded — Harmony does not and will not seed ROM/warez links.

## 4. Scraping heuristic

The provider is arbitrary, so the scrape is **source-agnostic** (no per-site
parsers): take every `<a href>`, resolve it to an absolute http(s) URL against
the search-page base, require non-empty visible text, drop duplicates and the
search page's own self-link, and cap at 30. This previews whatever a results
page links to — imperfectly (it includes some navigational links), but without
brittle per-site selectors. The pure core, `extract_links(html, base)`, is unit
tested without a network; only `fetch_results` performs I/O.

## 5. Per-vendor direct-download scaffolding (v0.16)

v0.16 also lays groundwork for a **future, optional** "direct download" feature —
letting Harmony download a chosen file directly from a vendor that has
explicitly enabled it. v0.16 ships **only the capability flag and its
plumbing/UI**; no direct-download action exists yet.

- Migration 007 adds `direct_download INTEGER NOT NULL DEFAULT 0` to
  `search_providers`. Off for every provider, seeded ones included.
- The flag round-trips through the repo (`set_direct_download`), the IPC DTOs
  (`directDownload`), the provider add/edit dialog (a checkbox), and the results
  UI (a clearly-disabled "⬇ Direct download · soon" marker on an opted-in
  vendor's group).
- Enabling it is a deliberate per-vendor act and changes nothing functional in
  v0.16; it is the seam a later release wires the actual download onto.

## 6. UX

- **Search screen** states the evolved contract ("Harmony previews what each
  provider found and opens your chosen link in your browser — it never downloads
  files for you"); `⬇` marks download sources.
- **Results** group by provider. Each group shows the provider name, an "open
  search page ↗" link (the `searchUrl` fallback), the scraped preview items
  (each an `openUrl` link), or a muted error / empty note. An opted-in vendor
  also shows the disabled direct-download marker.
- **Game detail → "Find downloads"** navigates to `/search` with the game's
  clean title in router state; the page pre-fills and auto-runs once.

## 7. Surfaces touched (v0.16)

| Layer | Change |
|---|---|
| `core/search/fetch.rs` (+tests) | new: HTTP fetch + `extract_links` HTML scrape with safeguards |
| `core/search/mod.rs` | register `fetch` |
| `migrations/007_*.sql` + `migrations.rs` | add `direct_download` column |
| `db/repo/search_providers.rs` | `direct_download` field/insert/map + `set_direct_download` |
| `commands/search.rs` | `run_search` → `Vec<ProviderResults>` (concurrent fetch); `directDownload` on DTOs + add/update |
| `ipc/search.ts` | `ProviderResults`/`SearchResultItem` types; `directDownload` plumbing |
| `features/search/SearchPage.tsx` | `ProviderResultGroup` preview rendering; evolved contract copy |
| `features/search/ProviderDialog.tsx` | direct-download checkbox |
| `scripts/mock-ipc.mjs` | preview-shaped `run_search`; `directDownload` on providers |

## 8. Out of scope (v0.16)

- Per-site result parsers (the scrape stays generic).
- Any actual direct-download action (scaffolding only).
- Bundling or hinting at any specific copyrighted-ROM source.
- Filtering/ranking scraped links beyond dedupe + the safeguards above.
