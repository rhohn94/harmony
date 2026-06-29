/**
 * SearchPage — File-search UI screen (W17 / v0.16 "Trove").
 *
 * Route: /search. Archetype: Search / Query-results (harmony-ux-design.md §5).
 *
 * Key contracts:
 *  - v0.16 PREVIEWS results: the backend fetches each provider's search page and
 *    returns the links it found, grouped by provider. Harmony NEVER downloads
 *    the content — each item's `url` is opened in the system browser via
 *    tauri-plugin-opener. (download-search-design.md)
 *  - Ships with an empty user-provider list; guides the user to add one.
 *  - Controller-navigable: query field → provider chips → result links → add button.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AuraButton, AuraField, AuraCard } from "@aura/react";
import { isDownloadProvider } from "./downloads";
import {
  listProviders,
  addProvider,
  updateProvider,
  removeProvider,
  runSearch,
} from "../../ipc/search";
import type {
  SearchProvider,
  ProviderResults,
  SearchResultItem,
} from "../../ipc/search";
import { isAppError } from "../../ipc/commands";
import { ProviderDialog } from "./ProviderDialog";
import type { ProviderFormData } from "./ProviderDialog";
import { listContainer, listItem, DUR, EASE_OUT, EASE_STANDARD } from "../../lib/motion";
import { filterItems } from "./resultFilter";
import {
  sortItems,
  isSortKey,
  SORT_KEYS,
  SORT_LABELS,
  loadSortPref,
  saveSortPref,
} from "./resultSort";
import type { SortKey } from "./resultSort";
import { parseBadges } from "./resultBadges";
import type { Badge } from "./resultBadges";
import {
  groupSelectionState,
  withGroupToggled,
  withItemToggled,
  needsOpenConfirm,
} from "./resultSelection";
import type { GroupSelectionState } from "./resultSelection";
import { rankItems, matchStrength, SEARCH_REGIONS } from "./resultRanking";
import type { RankQuery, MatchStrength } from "./resultRanking";
import { listConsoles } from "../../ipc/console";
import type { ConsoleInfo } from "../../ipc/console";

// ── Types ────────────────────────────────────────────────────────────────────

interface DialogState {
  open: boolean;
  provider?: SearchProvider;
}

// ── Result-visibility pipeline ───────────────────────────────────────────────

/** The single source of truth for which rows of a group are shown, in order:
 *  live filter → order (relevance ranking or title/scrape sort) → optional
 *  hide-weak. Used both to render a group and to tally the toolbar totals, so
 *  they never diverge. Pure. */
function computeVisible(
  items: SearchResultItem[],
  filter: string,
  sortKey: SortKey,
  rankQuery: RankQuery,
  hideWeak: boolean
): SearchResultItem[] {
  const filtered = filterItems(items, filter);
  const ordered =
    sortKey === "relevance"
      ? rankItems(filtered, rankQuery)
      : sortItems(filtered, sortKey);
  return hideWeak
    ? ordered.filter((i) => matchStrength(i, rankQuery) !== "none")
    : ordered;
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Empty state shown when no providers are configured. */
function EmptyState({ onAddProvider }: { onAddProvider: () => void }) {
  return (
    <AuraCard
      class="harmony-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 16,
        padding: 40,
        textAlign: "center",
        maxWidth: 480,
        margin: "0 auto",
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 32,
          lineHeight: 1,
          opacity: 0.4,
        }}
      >
        🔍
      </p>
      <h2 style={{ margin: 0, fontSize: 18 }}>No search providers yet</h2>
      <p style={{ margin: 0, color: "var(--aura-on-surface-muted)" }}>
        Add a provider to get started. A provider is a URL template like{" "}
        <code
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            background: "var(--aura-surface-raised)",
            padding: "1px 5px",
            borderRadius: 4,
          }}
        >
          https://example.com?q={"{query}"}
        </code>
        . Harmony constructs the link and opens it in your browser — it never
        downloads anything automatically.
      </p>
      <AuraButton variant="primary" onClick={onAddProvider}>
        + Add Provider
      </AuraButton>
    </AuraCard>
  );
}

/** Tone → colour for a parsed badge chip. */
function badgeColor(tone: Badge["tone"]): string {
  if (tone === "good") return "var(--aura-success)";
  if (tone === "bad") return "var(--aura-error)";
  return "var(--aura-on-surface-muted)";
}

/** A relevance "Match"/"Partial" chip (v0.18) — indicates that a row matches
 *  the searched-for game. `none`-strength rows render nothing. */
function MatchBadge({ strength }: { strength: MatchStrength }) {
  if (strength === "none") return null;
  const strong = strength === "strong";
  const color = strong ? "var(--aura-primary)" : "var(--aura-on-surface-muted)";
  return (
    <span
      title={strong ? "Strong match for your search" : "Partial match for your search"}
      style={{
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        background: strong ? "var(--harmony-provider-enabled-bg)" : "transparent",
        color,
        flexShrink: 0,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {strong ? "✓ Match" : "~ Partial"}
    </span>
  );
}

/** A compact chip for a title-parsed badge (region / revision / quality / type). */
function BadgeChip({ badge }: { badge: Badge }) {
  const color = badgeColor(badge.tone);
  return (
    <span
      title={badge.kind}
      style={{
        fontSize: 10,
        fontWeight: 600,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        border: `1px solid ${color}`,
        color,
        flexShrink: 0,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
      }}
    >
      {badge.label}
    </span>
  );
}

/** A single previewed result: a select checkbox + a focusable open-link button
 *  with title-parsed badges. */
function ResultRow({
  result,
  selected,
  strength,
  onToggleSelect,
}: {
  result: SearchResultItem;
  selected: boolean;
  strength: MatchStrength;
  onToggleSelect: (url: string) => void;
}) {
  async function handleOpen() {
    await openUrl(result.url);
  }

  const badges = parseBadges(result.title);

  return (
    <motion.li
      variants={listItem}
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(result.url)}
        aria-label={`Select ${result.title}`}
        style={{ marginLeft: 14, flexShrink: 0, cursor: "pointer" }}
      />
      <button
        onClick={handleOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flex: 1,
          minWidth: 0,
          padding: "10px 14px",
          borderRadius: 8,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--aura-on-surface)",
          textAlign: "left",
          fontSize: 14,
          transition: "background var(--harmony-dur-fast) var(--harmony-ease-out)",
        }}
        onMouseEnter={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "var(--aura-surface-raised)")
        }
        onMouseLeave={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
        onFocus={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background =
            "var(--aura-surface-raised)")
        }
        onBlur={(e) =>
          ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
        }
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {result.title}
        </span>
        <MatchBadge strength={strength} />
        {badges.map((b) => (
          <BadgeChip key={`${b.kind}:${b.label}`} badge={b} />
        ))}
        <span
          style={{
            fontSize: 11,
            color: "var(--aura-on-surface-muted)",
            flexShrink: 0,
          }}
        >
          ↗ open
        </span>
      </button>
    </motion.li>
  );
}

/** A small count/status pill for a provider header: visible link count, or an
 * error marker when the fetch failed. */
function GroupCountBadge({
  group,
  count,
}: {
  group: ProviderResults;
  count: number;
}) {
  const isError = group.error !== null;
  const label = isError ? "error" : String(count);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        minWidth: 18,
        textAlign: "center",
        padding: "2px 6px",
        borderRadius: 10,
        background: isError ? "transparent" : "var(--aura-surface-raised)",
        border: isError ? "1px solid var(--aura-error)" : "none",
        color: isError ? "var(--aura-error)" : "var(--aura-on-surface-muted)",
      }}
    >
      {label}
    </span>
  );
}

/** A tri-state "select all in this group" checkbox (checked / indeterminate /
 * empty), driven by the group's {@link GroupSelectionState}. */
function GroupSelectAll({
  state,
  onToggle,
  label,
}: {
  state: GroupSelectionState;
  onToggle: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "some";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      onChange={onToggle}
      aria-label={label}
      style={{ marginLeft: 16, flexShrink: 0, cursor: "pointer" }}
    />
  );
}

/** One provider's previewed results, as a collapsible group. The header is a
 * toggle (rotating chevron + provider name + count badge) plus a group
 * select-all; the body shows the filtered + sorted rows (or a no-match / empty /
 * error note). The open-search-page link and the direct-download marker sit
 * beside the toggle so they don't trigger a collapse. */
function ProviderResultGroup({
  group,
  collapsed,
  onToggle,
  visible,
  rankQuery,
  filter,
  selected,
  onToggleItem,
  onToggleGroup,
}: {
  group: ProviderResults;
  collapsed: boolean;
  onToggle: () => void;
  /** The rows actually shown (filter → order → hide-weak), computed by parent. */
  visible: SearchResultItem[];
  /** The executed search, for per-row match-strength badges. */
  rankQuery: RankQuery;
  filter: string;
  selected: ReadonlySet<string>;
  onToggleItem: (url: string) => void;
  onToggleGroup: (urls: string[]) => void;
}) {
  async function openSearchPage() {
    if (group.searchUrl) await openUrl(group.searchUrl);
  }

  const bodyId = `provider-group-${group.providerId}`;
  const visibleUrls = visible.map((i) => i.url);
  const selState = groupSelectionState(visibleUrls, selected);
  const filteredEmpty = group.items.length > 0 && visible.length === 0;

  return (
    <div style={{ borderTop: "1px solid var(--aura-outline-subtle, transparent)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 16px 4px 0",
        }}
      >
        {/* Group select-all (only when there are visible, selectable rows). */}
        {visible.length > 0 ? (
          <GroupSelectAll
            state={selState}
            onToggle={() => onToggleGroup(visibleUrls)}
            label={`Select all from ${group.providerName}`}
          />
        ) : (
          <span style={{ width: 16, marginLeft: 16, flexShrink: 0 }} />
        )}
        {/* The toggle owns the chevron + name + count and spans the free space. */}
        <button
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            minWidth: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "8px 0",
            color: "var(--aura-on-surface-muted)",
            textAlign: "left",
          }}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <motion.span
            aria-hidden
            animate={{ rotate: collapsed ? 0 : 90 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}
            style={{ fontSize: 10, lineHeight: 1, display: "inline-block", width: 10 }}
          >
            ▶
          </motion.span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {group.providerName}
          </span>
          <GroupCountBadge group={group} count={visible.length} />
        </button>
        {/* v0.16 scaffolding: a vendor with the future direct-download
            capability shows a clearly-disabled marker — no action is wired yet. */}
        {group.directDownload && (
          <span
            title="Direct download is not available yet — coming in a future release."
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--aura-on-surface-muted)",
              border: "1px solid var(--aura-on-surface-muted)",
              borderRadius: 4,
              padding: "1px 5px",
              opacity: 0.6,
              flexShrink: 0,
            }}
          >
            ⬇ Direct download · soon
          </span>
        )}
        {group.searchUrl && (
          <button
            onClick={openSearchPage}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              fontSize: 11,
              color: "var(--aura-primary)",
              flexShrink: 0,
            }}
            title="Open the full results page in your browser"
          >
            open search page ↗
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="body"
            id={bodyId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE_STANDARD }}
            style={{ overflow: "hidden" }}
          >
            {group.error ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 16px 10px",
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                }}
              >
                Couldn't load a preview ({group.error}). Use “open search page”
                above to view results in your browser.
              </p>
            ) : group.items.length === 0 ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 16px 10px",
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                }}
              >
                No previewable links found.
              </p>
            ) : filteredEmpty ? (
              <p
                style={{
                  margin: 0,
                  padding: "0 16px 10px",
                  fontSize: 12,
                  color: "var(--aura-on-surface-muted)",
                }}
              >
                {filter.trim()
                  ? `No matches for “${filter}” here.`
                  : "No likely matches here (hidden by “Hide unlikely matches”)."}
              </p>
            ) : (
              <motion.ul
                variants={listContainer}
                initial="hidden"
                animate="visible"
                style={{ listStyle: "none", margin: 0, padding: "0 4px 8px" }}
              >
                {visible.map((item) => (
                  <ResultRow
                    key={item.url}
                    result={item}
                    selected={selected.has(item.url)}
                    strength={matchStrength(item, rankQuery)}
                    onToggleSelect={onToggleItem}
                  />
                ))}
              </motion.ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Provider chip toggle with edit/remove actions. */
function ProviderChip({
  provider,
  onToggle,
  onEdit,
  onRemove,
}: {
  provider: SearchProvider;
  onToggle: (id: number) => void;
  onEdit: (provider: SearchProvider) => void;
  onRemove: (id: number) => void;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 13,
        fontWeight: provider.enabled ? 600 : 400,
        border: `1.5px solid ${provider.enabled ? "var(--aura-primary)" : "var(--aura-on-surface-muted)"}`,
        background: provider.enabled
          ? "var(--harmony-provider-enabled-bg)"
          : "transparent",
        color: provider.enabled
          ? "var(--aura-primary)"
          : "var(--aura-on-surface-muted)",
        transition: "all 0.12s",
      }}
    >
      <button
        onClick={() => onToggle(provider.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          color: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
        }}
        title={provider.enabled ? "Disable provider" : "Enable provider"}
      >
        {provider.enabled ? "✓ " : ""}
        {isDownloadProvider(provider) ? "⬇ " : ""}
        {provider.name}
      </button>
      <button
        onClick={() => onEdit(provider)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--aura-on-surface-muted)",
          fontSize: 11,
        }}
        title="Edit provider"
      >
        ✎
      </button>
      <button
        onClick={() => onRemove(provider.id)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "0 2px",
          color: "var(--aura-on-surface-muted)",
          fontSize: 12,
        }}
        title="Remove provider"
      >
        ×
      </button>
    </span>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function SearchPage() {
  // A "Find downloads for this title" jump (e.g. from the game detail page)
  // arrives with the title pre-filled in navigation state; we run it once the
  // providers have loaded.
  const location = useLocation();
  const initialQuery = (
    (location.state as { query?: string } | null)?.query ?? ""
  ).trim();
  const [providers, setProviders] = useState<SearchProvider[]>([]);
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<ProviderResults[] | null>(null);
  // Collapsed provider groups, keyed by providerId. Empty/errored groups start
  // collapsed so the populated providers lead; the user can fold any group.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Result-browsing controls (v0.17): live filter, sort (persisted), selection.
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(loadSortPref);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Structured search + relevance controls (v0.18): console/region filters, the
  // hide-weak toggle, and the executed query captured for ranking.
  const [consoles, setConsoles] = useState<ConsoleInfo[]>([]);
  const [consoleKey, setConsoleKey] = useState("");
  const [region, setRegion] = useState("");
  const [hideWeak, setHideWeak] = useState(false);
  const [rankQuery, setRankQuery] = useState<RankQuery>({ name: "" });
  const [running, setRunning] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const queryRef = useRef<HTMLInputElement>(null);
  const didAutoRun = useRef(false);

  // Load providers + the console catalog (for the structured-search select) on
  // mount. A console-list failure simply leaves the select empty.
  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
    listConsoles()
      .then(setConsoles)
      .catch(() => setConsoles([]));
  }, []);

  // Run search: collect results from enabled providers, grouped by provider.
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const active = providers.filter((p) => p.enabled);
    if (active.length === 0) return;

    // Resolve the selected console into a short token for the backend compose
    // (e.g. "SNES") and richer tokens for client-side ranking (name + abbr +
    // key, so any of them matches a result title).
    const selectedConsole = consoles.find((c) => c.key === consoleKey);
    const consoleComposeToken = selectedConsole?.abbreviation ?? "";
    const consoleRankTokens = selectedConsole
      ? `${selectedConsole.name} ${selectedConsole.abbreviation} ${selectedConsole.key}`
      : "";
    const reg = region.trim();

    setRunning(true);
    setSearchError(null);
    setResults(null);
    // A new search is a fresh browse: clear the filter and any selection, and
    // capture the executed query for relevance ranking + Match badges.
    setFilter("");
    setSelected(new Set());
    setRankQuery({
      name: q,
      console: consoleRankTokens || undefined,
      region: reg || undefined,
    });

    try {
      const all = await runSearch({
        query: q,
        console: consoleComposeToken || undefined,
        region: reg || undefined,
      });
      setResults(all);
      // Start with empty/errored groups folded; populated providers stay open.
      setCollapsed(
        new Set(all.filter((g) => g.items.length === 0).map((g) => g.providerId))
      );
    } catch (err) {
      const detail = isAppError(err) ? err.detail : String(err);
      setSearchError(detail);
    } finally {
      setRunning(false);
    }
  }, [query, providers, consoles, consoleKey, region]);

  // Auto-run a search that arrived pre-filled via navigation state ("Find
  // downloads for this title"), once providers have loaded so enabled ones
  // contribute. Runs at most once per mount.
  useEffect(() => {
    if (didAutoRun.current || !initialQuery || providers.length === 0) return;
    didAutoRun.current = true;
    void handleSearch();
  }, [providers, initialQuery, handleSearch]);

  // Keyboard: Enter in query field runs search.
  function handleQueryKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") handleSearch();
  }

  // Provider management callbacks.
  async function handleToggle(id: number) {
    const p = providers.find((x) => x.id === id);
    if (!p) return;
    const updated = await updateProvider({ id, enabled: !p.enabled });
    setProviders((prev) => prev.map((x) => (x.id === id ? updated : x)));
  }

  function handleEditOpen(provider: SearchProvider) {
    setDialog({ open: true, provider });
  }

  async function handleRemove(id: number) {
    await removeProvider({ id });
    setProviders((prev) => prev.filter((x) => x.id !== id));
  }

  async function handleDialogSave(data: ProviderFormData) {
    if (dialog.provider) {
      const updated = await updateProvider({
        id: dialog.provider.id,
        name: data.name,
        urlTemplate: data.urlTemplate,
        directDownload: data.directDownload,
        composeFilters: data.composeFilters,
      });
      setProviders((prev) =>
        prev.map((x) => (x.id === dialog.provider!.id ? updated : x))
      );
    } else {
      const created = await addProvider(data);
      setProviders((prev) => [...prev, created]);
    }
    setDialog({ open: false });
  }

  // Collapse controls for the result groups.
  function toggleGroup(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function expandAll() {
    setCollapsed(new Set());
  }
  function collapseAll() {
    setCollapsed(new Set((results ?? []).map((g) => g.providerId)));
  }

  // Sort: persist the choice so it carries across searches and restarts.
  function handleSortChange(key: SortKey) {
    setSortKey(key);
    saveSortPref(key);
  }

  // Selection (keyed by result url).
  function toggleItem(url: string) {
    setSelected((prev) => withItemToggled(url, prev));
  }
  function toggleGroupSelection(urls: string[]) {
    setSelected((prev) => withGroupToggled(urls, prev));
  }
  function clearSelection() {
    setSelected(new Set());
  }
  async function openSelected() {
    const urls = [...selected];
    if (urls.length === 0) return;
    if (
      needsOpenConfirm(urls.length) &&
      !window.confirm(`Open ${urls.length} links in your browser?`)
    ) {
      return;
    }
    for (const url of urls) await openUrl(url);
  }

  // Results arrive already grouped per provider from the backend (v0.16).
  const hasProviders = providers.length > 0;
  const activeCount = providers.filter((p) => p.enabled).length;
  const totalItems = results?.reduce((n, g) => n + g.items.length, 0) ?? 0;
  // Precompute the visible rows per group (filter → order → hide-weak) once, as
  // the single source of truth for both rendering and the toolbar summary.
  const groupViews =
    results?.map((g) => ({
      group: g,
      visible: computeVisible(g.items, filter, sortKey, rankQuery, hideWeak),
    })) ?? [];
  const visibleTotal = groupViews.reduce((n, gv) => n + gv.visible.length, 0);
  const narrowing = filter.trim().length > 0 || hideWeak;

  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 800 }}
      aria-label="File search"
    >
      {/* Header */}
      <h1 style={{ margin: 0, fontSize: 22 }}>Search</h1>
      <p style={{ margin: 0, fontSize: 13, color: "var(--aura-on-surface-muted)" }}>
        Find games and info across your providers. Harmony{" "}
        <strong>previews what each provider found</strong> and opens your chosen
        link in your browser — it <strong>never downloads files for you</strong>.{" "}
        <span aria-hidden>⬇</span> marks download sources.
      </p>

      {/* Query + structured filters + run */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <AuraField style={{ flex: 1, minWidth: 200 }}>
          <input
            ref={queryRef}
            name="search-query"
            className="harmony-input"
            type="search"
            value={query}
            placeholder="Game name…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleQueryKey}
          />
        </AuraField>
        {/* Structured filters (v0.18): always feed relevance ranking; appended
            to a provider's query only when it has compose-filters enabled. */}
        <select
          name="search-console"
          className="harmony-input"
          aria-label="Console"
          value={consoleKey}
          onChange={(e) => setConsoleKey(e.target.value)}
          style={{ fontSize: 13, padding: "6px 8px", maxWidth: 180 }}
        >
          <option value="">Any console</option>
          {consoles.map((c) => (
            <option key={c.key} value={c.key}>
              {c.abbreviation || c.name}
            </option>
          ))}
        </select>
        <select
          name="search-region"
          className="harmony-input"
          aria-label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          style={{ fontSize: 13, padding: "6px 8px", maxWidth: 150 }}
        >
          <option value="">Any region</option>
          {SEARCH_REGIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <AuraButton
          variant="primary"
          onClick={handleSearch}
          disabled={!query.trim() || activeCount === 0 || running}
        >
          {running ? "Searching…" : "Search"}
        </AuraButton>
      </div>

      {/* Provider chips */}
      {hasProviders ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--aura-on-surface-muted)", marginRight: 2 }}>
            Providers:
          </span>
          {providers.map((p) => (
            <ProviderChip
              key={p.id}
              provider={p}
              onToggle={handleToggle}
              onEdit={handleEditOpen}
              onRemove={handleRemove}
            />
          ))}
          <AuraButton
            variant="ghost"
            style={{ fontSize: 13, padding: "4px 10px" }}
            onClick={() => setDialog({ open: true })}
          >
            + Add
          </AuraButton>
        </div>
      ) : (
        /* No providers configured → empty state */
        <EmptyState onAddProvider={() => setDialog({ open: true })} />
      )}

      {/* Search error */}
      {searchError && (
        <p style={{ margin: 0, color: "var(--aura-error)", fontSize: 14 }}>
          Search failed: {searchError}
        </p>
      )}

      {/* Results — one previewed group per provider */}
      {results !== null && (
        <AuraCard
          class="harmony-panel"
          style={{ padding: 0, overflow: "hidden" }}
        >
          {results.length === 0 ? (
            <p
              style={{
                margin: 0,
                padding: "20px 16px",
                color: "var(--aura-on-surface-muted)",
                fontSize: 14,
              }}
            >
              No enabled providers to search.
            </p>
          ) : (
            <>
              {/* Browse toolbar: filter + sort + summary + expand/collapse-all.
                  Shown once there are any links to browse. */}
              {totalItems > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--aura-outline-subtle, transparent)",
                  }}
                >
                  <AuraField style={{ flex: 1, minWidth: 160 }}>
                    <input
                      name="result-filter"
                      className="harmony-input"
                      type="search"
                      value={filter}
                      placeholder="Filter results…"
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </AuraField>
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    Sort
                    <select
                      name="result-sort"
                      className="harmony-input"
                      value={sortKey}
                      onChange={(e) =>
                        isSortKey(e.target.value) && handleSortChange(e.target.value)
                      }
                      style={{ fontSize: 12, padding: "4px 6px" }}
                    >
                      {SORT_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {SORT_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* Hide-weak (v0.18): off by default; weak matches are
                      otherwise demoted to the bottom, never hidden silently. */}
                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                      cursor: "pointer",
                    }}
                    title="Hide rows that don't match your search (kept, just hidden)"
                  >
                    <input
                      name="result-hide-weak"
                      type="checkbox"
                      checked={hideWeak}
                      onChange={(e) => setHideWeak(e.target.checked)}
                    />
                    Hide unlikely matches
                  </label>
                  {results.length > 1 && (
                    <>
                      <button
                        onClick={expandAll}
                        disabled={collapsed.size === 0}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: collapsed.size === 0 ? "default" : "pointer",
                          padding: 0,
                          fontSize: 11,
                          color:
                            collapsed.size === 0
                              ? "var(--aura-on-surface-muted)"
                              : "var(--aura-primary)",
                          opacity: collapsed.size === 0 ? 0.5 : 1,
                        }}
                      >
                        Expand all
                      </button>
                      <span style={{ color: "var(--aura-on-surface-muted)", fontSize: 11 }}>
                        ·
                      </span>
                      <button
                        onClick={collapseAll}
                        disabled={collapsed.size === results.length}
                        style={{
                          background: "none",
                          border: "none",
                          cursor:
                            collapsed.size === results.length ? "default" : "pointer",
                          padding: 0,
                          fontSize: 11,
                          color:
                            collapsed.size === results.length
                              ? "var(--aura-on-surface-muted)"
                              : "var(--aura-primary)",
                          opacity: collapsed.size === results.length ? 0.5 : 1,
                        }}
                      >
                        Collapse all
                      </button>
                    </>
                  )}
                  <span
                    style={{
                      width: "100%",
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    {narrowing
                      ? `${visibleTotal} of ${totalItems} links shown`
                      : `${totalItems} ${totalItems === 1 ? "link" : "links"} across ${results.length} ${results.length === 1 ? "provider" : "providers"}`}
                  </span>
                </div>
              )}
              {groupViews.map(({ group, visible }) => (
                <ProviderResultGroup
                  key={group.providerId}
                  group={group}
                  collapsed={collapsed.has(group.providerId)}
                  onToggle={() => toggleGroup(group.providerId)}
                  visible={visible}
                  rankQuery={rankQuery}
                  filter={filter}
                  selected={selected}
                  onToggleItem={toggleItem}
                  onToggleGroup={toggleGroupSelection}
                />
              ))}
              {/* Selection footer: batch-open the chosen links in the browser. */}
              {selected.size > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    borderTop: "1px solid var(--aura-outline-subtle, transparent)",
                    background: "var(--aura-surface-raised)",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13 }}>
                    {selected.size} selected
                  </span>
                  <button
                    onClick={clearSelection}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    Clear
                  </button>
                  <AuraButton variant="primary" onClick={openSelected}>
                    Open {selected.size} in browser ↗
                  </AuraButton>
                </div>
              )}
            </>
          )}
          {results.length > 0 && totalItems === 0 && (
            <p
              style={{
                margin: 0,
                padding: "4px 16px 16px",
                color: "var(--aura-on-surface-muted)",
                fontSize: 12,
              }}
            >
              No previewable links found for "{query}". Use a provider's “open
              search page” link to see full results in your browser.
            </p>
          )}
        </AuraCard>
      )}

      {/* Add / Edit provider dialog */}
      <ProviderDialog
        open={dialog.open}
        provider={dialog.provider}
        onSave={handleDialogSave}
        onClose={() => setDialog({ open: false })}
      />
    </section>
  );
}
