# Interaction Wiring (Aura ↔ React) — Design

> **Up:** [↑ Docs](../README.md) · **Sib:** [games-directory](games-directory-design.md),
> [library-filtering](library-filtering-design.md)

## 1. Problem

Harmony renders the [Aura](../../vendor/aura) design system, which ships as
framework-free **custom elements**, through a thin React adapter
(`vendor/aura/bindings/react/aura-react.js`). The adapter forwards standard
props (including `onClick`) onto the custom element and wires a separate
`events={{ … }}` map via `addEventListener`. Because `addEventListener` accepts
any string, an `events` key that names a **non-existent** event registers a
listener that can never fire — a silent failure with no type error and no
runtime warning. Several screens were built against an imagined Aura event API,
producing dead controls that still type-check and still pass the test suite.

## 2. Ground-truth Aura contracts

Extracted from `vendor/aura/js/*.js` (authoritative):

| Element | Emits | Correct React wiring | Dead anti-pattern |
|---|---|---|---|
| `<aura-button>` | native `click` only (`this.click()` on Enter/Space) | `onClick={fn}` | `events={{ "aura-click": fn }}` |
| `<aura-field>` | nothing — it is a **label/glow wrapper** around a contained `CONTROL_SELECTOR` child | contained `<input>`/`<select>`/`<textarea>` with React `value`+`onChange`; optional `label` attr on the field | `value`/`type`/`placeholder` props on the field + `events={{ "aura-field:input": fn }}`, with no child control |
| `<aura-select>` | `aura:change` (colon); projects `<aura-option>` children | `<aura-option>` children + `events={{ "aura:change": fn }}` — **or** a native `<select>`+`onChange` | native `<option>` children + `events={{ "aura-change": fn }}` |
| `<aura-dialog>` | `aura:dialog-open` / `aura:dialog-close`; driven by the `open` attribute | `open={bool}` | — (already correct in app) |

## 3. Decisions

- **Buttons → `onClick`.** The native-click path is what Aura actually fires and
  what React delegates; it already works for every button that used it
  (CoreRow, GameDetailPage, the dialog action buttons).
- **Fields → contained native `<input>`.** Matches the working
  FamiliarPane/RetroArchPane fields. The `ref` (for auto-focus) moves onto the
  inner `<input>`, not the wrapper. A shared `.harmony-input` class
  (token-driven) styles the contained inputs.
- **Selects → native `<select>`.** Rather than re-home the options onto
  `<aura-option>` and adopt the custom dropdown, the two Settings selects use a
  native `<select>`+`onChange` — the exact pattern LibraryFilters already uses
  successfully. It is accessible, trivially testable, and visually consistent.
  A custom Aura dropdown is a deferred polish item, not a correctness need.

## 4. Guardrails (so this never silently ships again)

1. **Static guard** — `scripts/aura-wiring.test.mjs` (vitest) scans `src/` and
   fails on any literal `aura-click`, `aura-field:input`, or hyphenated
   `aura-change` listener key, or any `<AuraField …>` carrying input props
   (`value=`/`type=`/`placeholder=`) without a child control. Deterministic, no
   browser, runs in `pnpm test`.
2. **Real-gesture proof** — `scripts/inspect-create-success.mjs` and the search
   inspect drive the UI with **real** `page.click()` / typed input (not a
   synthetic `aura-click` dispatch) and assert the resulting state change,
   failing non-zero on regression.

The prior tests failed precisely because they fabricated the same fictional
event they were verifying; the rule going forward is that an interaction test
must use a real user gesture against the real Aura element.
