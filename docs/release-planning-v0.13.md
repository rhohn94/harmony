# Release Planning — v0.13

> status: agreed
> Companion to `version-design.md` and `version-history.md`. Captures the
> scope, pass structure, and implementation ledger for v0.13.
> Archive into `version-history.md` when the release ships.

---

## 1. Target

| | |
|---|---|
| **Version** | `v0.13` |
| **Previous** | `v0.12` (Curator — import + auto-metadata, By-Console view) |
| **Theme** | "Reveal" — make on-disk images actually appear. Cover art and console photos were fetched and cached to disk but never displayed because the Tauri asset protocol was disabled; this enables it (scoped to the art dirs) so every filesystem-backed image renders. |

A user-reported regression fix: images did not load in the deployed app. Cover
art (`art-cache/`) and console photos (`console-art/`) are referenced via
`convertFileSrc()` (Tauri's `asset:` protocol), but `tauri.conf.json` never
enabled the asset protocol, so the webview blocked every such URL. Design note:
[`runtime-verification-design.md`](design/runtime-verification-design.md) (the
headless smoke gate uses mock IPC + a static server, so it cannot exercise the
real asset protocol — this fix was verified in the running Tauri app).

---

## 2. Features

| ID | Title | Acceptance |
|---|---|---|
| **W131** | Enable the asset protocol | `tauri.conf.json` `app.security.assetProtocol` is enabled with a scope covering `$APPDATA/art-cache/**` + `$APPDATA/console-art/**` (matching the Rust `Paths` app-support root). Cover art on the Library/detail screens and console photos on the By-Console screens render from disk. Verified in the real built app (not just the mock-IPC smoke harness). |

---

## 3. Strategy

Single config change — no Rust/TS code touched. The scope is deliberately
narrow (only the two art directories under the app-support root), not a blanket
`$APPDATA/**`, so the webview's read access via the asset protocol is limited to
cached art. Verified by building the real bundle, launching it, and confirming
both image surfaces render (Super Mario Bros. cover art + the gen-2 console
photos).

## 4. Out of scope

- Broadening the asset scope beyond the art directories.
- Embedding art as `data:` URIs (the blurred hero already uses that path; cover
  art and console photos stay on disk + asset protocol).
- Any change to how art is fetched or cached (unchanged from v0.12).

---

## 5. Implementation ledger

| Item | Branch | Status | Notes |
|---|---|---|---|
| W131 — enable asset protocol | version/0.13 (in-session) | ☑ | `assetProtocol.enable: true` + scope `$APPDATA/art-cache/**`, `$APPDATA/console-art/**`; verified in the running app — cover art + all console photos load. |

**Release rows**

| Step | Status | Notes |
|---|---|---|
| version/0.13 → dev | ☑ | merged `--no-ff`; gates green on dev |
| dev → main promoted + tagged v0.13 | ☑ | |
| deployed | ☑ | /Applications/Harmony.app + deployed-apps/current at 0.13.0 |
| pushed to origin | ☑ | main + dev + tag v0.13 (fast-forward, no force) |
