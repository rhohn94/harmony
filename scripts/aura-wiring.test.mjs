// Aura interaction-wiring guard (v0.9 "Contact").
//
// Locks in the interaction-layer repair so the dead-wiring class can never
// silently return. The whole defect was that controls were bound to DOM events
// the Aura elements never dispatch (so handlers stayed silent) while the suite
// stayed green — because the old tests fabricated the same fictional events.
//
// Ground truth (vendor/aura/js/*.js):
//   - <aura-button> emits native `click` only → wire with React onClick, never
//     events={{ "aura-click": ... }}.
//   - <aura-field> is a label/glow WRAPPER around a contained control; it emits
//     no "aura-field:input" and renders no input of its own → put a real
//     <input>/<select>/<textarea> child with React value+onChange on the CHILD,
//     never input props (value/type/placeholder) or events on <AuraField>.
//   - <aura-select> emits "aura:change" (colon), never "aura-change" (hyphen).
//
// Deterministic, browser-free; runs under vitest (see vitest.config.ts include).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Recursively collect files under dir matching one of the extensions. */
function walk(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const FILES = walk(SRC, [".ts", ".tsx"]);

// Event-name literals that no Aura element ever dispatches — any listener bound
// to one is dead on arrival. (`aura:change` with a colon is the REAL select
// event and is intentionally not banned.)
const DEAD_EVENTS = ['"aura-click"', '"aura-field:input"', '"aura-change"'];

// Opening <AuraField ...> tag carrying input props — the wrapper renders no
// input, so these belong on a contained <input> child instead.
const AURAFIELD_OPEN = /<AuraField\b[^>]*>/g;
const INPUT_PROP = /\b(value|type|placeholder|events)=/;

describe("Aura interaction wiring (v0.9 W94)", () => {
  it("binds no listeners to events Aura never dispatches", () => {
    const offenders = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const needle of DEAD_EVENTS) {
        if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
      }
    }
    expect(
      offenders,
      `Dead Aura event listeners found — Aura never emits these, so the handler ` +
        `never fires. Use onClick (buttons), a contained <input> onChange ` +
        `(fields), or "aura:change" (selects):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("never puts input props on the <AuraField> wrapper", () => {
    const offenders = [];
    for (const file of FILES) {
      const text = readFileSync(file, "utf8");
      for (const tag of text.match(AURAFIELD_OPEN) ?? []) {
        if (INPUT_PROP.test(tag)) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, " ").slice(0, 80)}`);
        }
      }
    }
    expect(
      offenders,
      `<AuraField> is a wrapper and renders no input of its own. Move ` +
        `value/type/placeholder/events onto a contained <input> child:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
