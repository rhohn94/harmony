# Release Planning — v0.16

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.16.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.16` |
| **Previous** | `v0.15` (Arcade — in-page play, overlay, immersive, transitions) |
| **Theme** | "Trove" — see what you found before you go get it. Search previews the candidate files each provider surfaces, in-app, and opens the chosen one in the browser — while Harmony never downloads anything itself. |

Evolves the file-search feature (W9/W17, v0.6/v0.11) from bare link-out to an
in-app preview. Design:
[`download-search-design.md`](design/download-search-design.md).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W161** | In-app result preview | `run_search` fetches each enabled provider's public search-results page and scrapes candidate links (`core/search/fetch.rs`), returning one `ProviderResults` group per provider (scraped `items`, the constructed `searchUrl` fallback, an optional per-provider `error`). Source-agnostic generic scrape (`extract_links`, unit-tested without a network). Safeguards: http(s)-only, 8 s timeout, 2 MiB body cap (enforced while reading), 30-result + 200-char caps, one scoped thread per provider. The load-bearing contract holds: Harmony never downloads content; the user opens links in their browser. The Search UI renders the grouped preview, the evolved contract copy, and per-provider error/empty states. |
| **W162** | Per-vendor direct-download scaffolding | A `direct_download` capability flag (migration 007, default 0) plumbed through `db::repo::search_providers` (`set_direct_download`), the IPC DTOs (`directDownload`), the provider add/edit dialog (checkbox), and a clearly-disabled "⬇ Direct download · soon" results marker. Off for every provider, seeded ones included; no download action wired. Groundwork only. |

**Carried in (maintenance/compliance, merged to dev ahead of the feature):**

| Item | Notes |
|---|---|
| GPL-3.0 attribution | `THIRD-PARTY-NOTICES.md` + `licenses/GPL-3.0.txt` document bundled EmulatorJS v4.2.3 (GPL-3.0), fceumm (GPL-2.0+), nipplejs (MIT), libunrar (UnRAR license). README + in-page-play design updated. |
| Flaky-test isolation | `core::cores::install` tests now use `tempfile` per-test dirs (was a shared-pid/timestamp temp-dir collision + sibling-clobbering cleanup); `db` test no longer mutates global `HOME`. 25/25 clean runs. |

---

## 3. Strategy

Single integration-master session, no PM. Order: merge the two ready chip
branches to `dev` first (independent fixes, verified green), then build the
feature on a `feat/v0.16-downloads-preview` branch off the updated `dev`.

The consequential design decision — relaxing the prior "never fetch server-side"
invariant to allow scraping provider **search-result pages** for the preview —
was confirmed with the user, who chose the **generic HTML scraping** approach
(over structured-API-only or no-fetch). The genuinely-load-bearing invariant
(never download content; legal sources only; user clicks through) is preserved
and documented in `download-search-design.md` §2 with the fetch safeguards.

Full gates before merge. The live preview render is exercised by the component +
the preview-shaped mock-IPC (`mock-ipc.test`); the smoke harness renders `/search`
with the new shape but does not trigger a live search, so the populated preview
list is verified via unit tests rather than the headless screenshot.

## 4. Out of scope

- Per-site result parsers — the scrape stays generic (`extract_links`).
- Any actual direct-download action — v0.16 ships the per-vendor flag + UI only.
- Bundling or hinting at any specific copyrighted-ROM source.
- Ranking/filtering scraped links beyond dedupe + the safeguards.
- The 10-foot TV UI epic (#8–#13) and the boot-latency spike (#14) — later.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| GPL-3.0 attribution (chip) | worktree-agent-ac2d6d76… | ☑ | merged to dev `--no-ff` |
| Flaky-test isolation (chip) | worktree-agent-ab7f53c1… | ☑ | merged to dev `--no-ff`; 25/25 clean |
| W161 — in-app result preview | feat/v0.16-downloads-preview | ☑ | `fetch.rs` scrape + safeguards (9 new rust tests); `run_search` → `Vec<ProviderResults>` concurrent; `ProviderResultGroup` UI; evolved copy; mock-IPC preview shape. |
| W162 — direct-download scaffolding | feat/v0.16-downloads-preview | ☑ | migration 007; repo field + `set_direct_download` (+tests); DTO `directDownload`; dialog checkbox; disabled results marker. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| chips → dev | ☑ | both merged `--no-ff`, worktrees cleaned, dev green (241 cargo) |
| feat/v0.16-downloads-preview → dev | ☐ | merge `--no-ff` after full gates |
| dev → main promoted + tagged v0.16 | ☐ | |
| pushed to origin | ☐ | main + dev + tag v0.16 (fast-forward, no force) |
