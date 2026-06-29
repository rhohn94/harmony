# Release Planning — v0.18

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.18.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.18` |
| **Previous** | `v0.16` (Trove — in-app result preview), `v0.17` (Sift — browsable previewed results) |
| **Theme** | "Focus" — v0.16/v0.17 preview and browse what a provider returned, but the scrape is source-agnostic ("grab every `<a href>`"), so it surfaces nav/footer/pagination chrome with no sense of *what the user searched for*. v0.18 makes results relevant: junk links are dropped at the scrape, results are **ranked** so the searched-for game leads and is **indicated** with a Match badge, and search gains **structured fields** (console, region) beyond the bare game name. |

Builds on the v0.16 scrape + v0.17 browse toolbar. Evolves
[`download-search-design.md`](design/download-search-design.md); the relevance
& structured-search design lives in
[`download-browsing-ux-design.md`](design/download-browsing-ux-design.md) §6.

This release **does** touch the backend (the scraper and `run_search`) and adds
a migration — the first download-feature release to do so since v0.16. The
load-bearing contract is untouched: Harmony **never downloads content**; every
action opens the user's chosen link in the system browser. The scraper still
only fetches each provider's public **search-results HTML** (metadata about what
is available), never content.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W180** | Junk-link filtering at the scrape | `extract_links` (Rust) drops obvious page chrome before it becomes a "result": pure-numeric / single-character anchor text (pagination), exact-match nav/legal/social words (Home, Login, Next, Privacy, …), and below a minimum length. Conservative — only exact-word chrome and pagination are dropped, never a real game title. Unit-tested in `fetch.rs`. |
| **W181** | Per-provider compose-filters + structured `run_search` | Migration 008 adds a per-provider `compose_filters` flag (off by default). `run_search` gains structured `console` + `region` params; for a provider with `compose_filters` on, the non-empty filters are appended to that provider's query before substitution (narrowing at the source); otherwise the query is the bare game name. Repo + DTO + add/update commands carry the new flag. Rust round-trip tests. |
| **W182** | Relevance ranking module | A pure, framework-free `resultRanking.ts`: `scoreItem` (query-term coverage over title+url, with console/region/title-prefix bonuses), `matchStrength` (`strong` = all name terms present, `partial` = some, `none` = zero), and a stable `rankItems`. Unit-tested (vitest). |
| **W183** | Relevance default sort + Match badge | A new **Relevance** sort key (the new default) orders each provider group by `rankItems`; existing Found / Title A→Z / Z→A remain. Strongly/partially matching rows carry a **Match** / **Partial** badge so "the searched-for game" is visibly indicated. Pure logic in `resultRanking`/`resultSort`; rendered in `SearchPage`. |
| **W184** | Structured search fields + hide-weak toggle | The search bar gains a **console** select (from `list_consoles`) and a **region** select; both feed the client-side ranking always, and the backend `run_search` (composed per-provider per W181). A **Hide unlikely matches** toggle (off by default) drops `none`-strength rows from view; weak matches are otherwise demoted, never hidden silently. |
| **W185** | Provider compose-filters UI | `ProviderDialog` gains an "Append search filters (console/region) to this provider's query" checkbox wired through the `add_provider`/`update_provider` IPC to the new `compose_filters` flag. Off by default; persisted. |

---

## 3. Strategy

Single integration-master session, no PM, Noir paradigm, in-session
orchestration (release-phase-model Auto). The frontend items all touch
`SearchPage.tsx` and the same result list, and the backend items form one
pipeline (scraper → `run_search` → IPC → DTO), so parallel worktree agents would
collide — implemented sequentially in-session. Browsing/ranking logic is
extracted into a small **pure, unit-tested module** (`resultRanking.ts`,
matching the v0.17 `resultFilter`/`resultSort`/`resultBadges`/`resultSelection`
pattern) so `SearchPage` stays a thin view and the logic is covered
framework-free.

All items land on a `feat/v0.18-search-relevance` branch off `dev`, merged
`--no-ff` after full gates.

Full gates before merge: `pnpm test`, `cargo test`, typecheck, eslint, clippy
`-D warnings`, `pnpm tauri build`, and `recipe.py smoke` (exit 0,
`guiOk=true`). Because the smoke harness renders `/search` without triggering a
live search, the populated ranking/badge/hide states are verified by the pure
module unit tests plus a headless mock-IPC-driven screenshot pass during
implementation (the mock `run_search` fixture is enriched with junk + mixed
console/region rows to exercise ranking and hide-weak headlessly).

---

## 4. Out of scope

- **Cross-provider dedupe** ("available from N providers") — the standout
  game-first differentiator, still deferred (needs title-normalization
  heuristics).
- **Link-liveness check** (alive/dead via `HEAD`) — still deferred; the one
  `[N]` item, gated behind a setting when it lands.
- **Per-site result parsers** — the scrape stays source-agnostic; W180 only
  *filters* the generic anchor extraction, it does not add per-provider parsing.
- A learned/weighted ranking model — scoring is a transparent, testable
  heuristic, not statistical.
- Any actual direct-download action (still scaffolding only, from v0.16).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W180 — junk-link filtering | feat/v0.18-search-relevance | ☑ | `extract_links` chrome/pagination drop + 2 Rust tests |
| W181 — compose-filters + structured run_search | feat/v0.18-search-relevance | ☑ | migration 008, repo/DTO/commands, `effective_query` composition (5 Rust tests) |
| W182 — relevance ranking module | feat/v0.18-search-relevance | ☑ | `resultRanking.ts` (score/strength/rank, 14 vitest) |
| W183 — relevance default sort + Match badge | feat/v0.18-search-relevance | ☑ | new `relevance` SortKey (default) + Match/Partial chip |
| W184 — structured fields + hide-weak | feat/v0.18-search-relevance | ☑ | console + region selects, wired to ranking + backend; hide-weak toggle |
| W185 — provider compose-filters UI | feat/v0.18-search-relevance | ☑ | ProviderDialog checkbox + IPC plumbing |

Gates: typecheck, eslint, **111 vitest** (+14), **259 cargo** (+7), clippy `-D warnings`,
vite build, `recipe.py smoke` (6 routes, `guiOk=true`), full release build (optimized
binary + `Harmony.app` + `Harmony_0.18.0_aarch64.dmg`; DMG produced with the GUI-only
Finder-cosmetics step skipped). Populated ranking/badge/hide-weak/dialog states verified
via a headless mock-IPC Playwright pass.

**Release rows**

| Step | Status | Notes |
|---|---|---|
| feat/v0.18-search-relevance → dev | ☑ | merged `--no-ff` after full gates |
| dev → main promoted + tagged v0.18 | ☑ | `--no-ff` dev→main, dev fast-forwarded so dev≡main, lightweight tag `v0.18` |
| pushed to origin | ☑ | dev + main + tag `v0.18` (fast-forward, no force) |
