# Release Planning — v0.8

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.8.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.8` |
| **Previous** | `v0.7` (Forge — core discovery) |
| **Theme** | "Confirm" — a UX follow-up: the create-games-folder flow now confirms success and offers to reveal the new folder in Finder. |

**Context (user-reported bug).** After confirming "Create a games folder", the
dialog closed silently with no feedback. Because a freshly-created folder is
empty, the Library stays empty afterwards, so it looked like nothing happened.
There was also no way to open the created folder. This release makes the success
explicit and adds a "Reveal in Finder" action.

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W81** | Success confirmation + reveal-in-Finder | On a successful create, `CreateGamesFolderDialog` no longer auto-closes; it shows a success state with the absolute path, a **Reveal in Finder** button (`revealItemInDir`, already permitted by `opener:default` — no capability change), and a Done button. The library/settings views still refresh (`onCreated` fires on success). Reopening the dialog resets to the form. |
| **W82** | Verify | Typecheck/lint/tests green; `node scripts/inspect-empty-states.mjs` still passes; a capture of the success state confirms the path + Reveal-in-Finder affordance render. All gates green. |

---

## 3. Strategy

In-session orchestration (Noir + Auto). Small, frontend-only fix in
`CreateGamesFolderDialog` plus a TS IPC wrapper for `revealItemInDir`. The
existing create → add-content-folder → rescan chain is unchanged; only the
post-success UX changes. Each item committed atomically; full gate suite before
merge.

## 4. Out of scope

- The two new feature tickets filed alongside this report — searching for game
  downloads ([#6](https://github.com/rhohn94/harmony/issues/6)) and expanding the
  console list to gens 1–6 ([#7](https://github.com/rhohn94/harmony/issues/7)) —
  are backlog, not part of v0.8.
- `openPath` (opening the folder itself) — would need an added `allow-open-path`
  permission; `revealItemInDir` covers the need without a capability change.

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W81 — success confirmation + reveal-in-Finder | version/0.8 (in-session) | ☑ | `CreateGamesFolderDialog` no longer auto-closes on success — shows a "✓ Games folder ready" state with the created path, a `revealItemInDir` "Reveal in Finder" button (covered by `opener:default`), and Done; `onCreated` still fires so views refresh; reopening resets to the form. |
| W82 — verify | version/0.8 (in-session) | ☑ | `scripts/inspect-create-success.mjs` drives the flow headlessly and captured the success state (path + Reveal-in-Finder confirmed); typecheck/lint/60 JS tests/cargo check/visual-inspect all green. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.8 → dev | ☐ | |
| dev → main promoted + tagged v0.8 | ☐ | |
| pushed to origin | ☐ | HUMAN-GATED — do not push without explicit go |
