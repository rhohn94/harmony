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

// ── Types ────────────────────────────────────────────────────────────────────

interface DialogState {
  open: boolean;
  provider?: SearchProvider;
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

/** A single previewed result rendered as a focusable link. */
function ResultRow({ result }: { result: SearchResultItem }) {
  async function handleOpen() {
    await openUrl(result.url);
  }

  return (
    <motion.li
      variants={listItem}
      style={{ listStyle: "none", margin: 0, padding: 0 }}
    >
      <button
        onClick={handleOpen}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
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
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {result.title}
        </span>
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

/** A small count/status pill for a provider header: link count, or an error
 * marker when the fetch failed. */
function GroupCountBadge({ group }: { group: ProviderResults }) {
  const isError = group.error !== null;
  const label = isError ? "error" : String(group.items.length);
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

/** One provider's previewed results, as a collapsible group. The header is a
 * toggle (rotating chevron + provider name + count badge); the body animates
 * open/closed. The open-search-page link and the scaffolded direct-download
 * marker sit beside the toggle so they don't trigger a collapse. */
function ProviderResultGroup({
  group,
  collapsed,
  onToggle,
}: {
  group: ProviderResults;
  collapsed: boolean;
  onToggle: () => void;
}) {
  async function openSearchPage() {
    if (group.searchUrl) await openUrl(group.searchUrl);
  }

  const bodyId = `provider-group-${group.providerId}`;

  return (
    <div style={{ borderTop: "1px solid var(--aura-outline-subtle, transparent)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 16px",
        }}
      >
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
          <GroupCountBadge group={group} />
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
            ) : (
              <motion.ul
                variants={listContainer}
                initial="hidden"
                animate="visible"
                style={{ listStyle: "none", margin: 0, padding: "0 4px 8px" }}
              >
                {group.items.map((item) => (
                  <ResultRow key={item.url} result={item} />
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
  const [running, setRunning] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const queryRef = useRef<HTMLInputElement>(null);
  const didAutoRun = useRef(false);

  // Load providers on mount.
  useEffect(() => {
    listProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, []);

  // Run search: collect results from enabled providers, grouped by provider.
  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    const active = providers.filter((p) => p.enabled);
    if (active.length === 0) return;

    setRunning(true);
    setSearchError(null);
    setResults(null);

    try {
      const all = await runSearch({ query: q });
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
  }, [query, providers]);

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

  // Results arrive already grouped per provider from the backend (v0.16).
  const hasProviders = providers.length > 0;
  const activeCount = providers.filter((p) => p.enabled).length;
  const totalItems = results?.reduce((n, g) => n + g.items.length, 0) ?? 0;

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

      {/* Query + run */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <AuraField style={{ flex: 1 }}>
          <input
            ref={queryRef}
            name="search-query"
            className="harmony-input"
            type="search"
            value={query}
            placeholder="Search…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleQueryKey}
          />
        </AuraField>
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
              {/* Summary + expand/collapse all (only worth it with >1 group). */}
              {results.length > 1 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: "var(--aura-on-surface-muted)",
                    }}
                  >
                    {totalItems} {totalItems === 1 ? "link" : "links"} across{" "}
                    {results.length} providers
                  </span>
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
                </div>
              )}
              {results.map((group) => (
                <ProviderResultGroup
                  key={group.providerId}
                  group={group}
                  collapsed={collapsed.has(group.providerId)}
                  onToggle={() => toggleGroup(group.providerId)}
                />
              ))}
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
