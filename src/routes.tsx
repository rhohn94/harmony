// Route table — the append-friendly routing seam (architecture-design.md §1.1).
// Each screen work item (W13/W15/W16/W17) adds EXACTLY ONE entry to the
// HARMONY_ROUTES array below, mapping its route path to its feature page; no
// item edits another's entry, so the integration master merges by concatenation.
//
// W2 seeds the table with lightweight placeholder pages so the shell + router
// render end-to-end now; later items swap the `element` for the real screen.

import type { ReactElement } from "react";

/** One screen in the app: a route path, its element, and a nav label. */
export interface HarmonyRoute {
  /** react-router path (relative to the shell). */
  path: string;
  /** The screen element rendered at this path. */
  element: ReactElement;
  /** Sidebar label; omit to keep the route out of the primary nav. */
  navLabel?: string;
  /** True for the index route (path "/"). */
  index?: boolean;
}

/** A minimal themed placeholder screen until the owning work item ships. */
function Placeholder({ title, owner }: { title: string; owner: string }) {
  return (
    <section className="harmony-panel" style={{ padding: 24, borderRadius: 12 }}>
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      <p style={{ color: "var(--aura-on-surface-muted)" }}>
        Placeholder screen — implemented by {owner}.
      </p>
    </section>
  );
}

// APPEND POINT — each screen item adds ONE object. Keep ordered by route.
export const HARMONY_ROUTES: readonly HarmonyRoute[] = [
  {
    path: "/",
    index: true,
    navLabel: "Library",
    element: <Placeholder title="Library" owner="W13" />,
  },
  {
    path: "/cores",
    navLabel: "Cores",
    element: <Placeholder title="Cores" owner="W16" />,
  },
  {
    path: "/search",
    navLabel: "Search",
    element: <Placeholder title="Search" owner="W17" />,
  },
  {
    path: "/settings",
    navLabel: "Settings",
    element: <Placeholder title="Settings" owner="W15" />,
  },
  // { path: "/game/:id", element: <GameDetail /> },  // W13 (no nav entry)
];
