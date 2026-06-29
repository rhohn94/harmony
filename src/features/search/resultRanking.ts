/**
 * Relevance ranking for previewed search results (W182 / v0.18 "Focus").
 *
 * Pure, framework-free scoring of a scraped result against the structured query
 * (game name + optional console/region tokens). Drives the new default
 * "Relevance" sort and the Match badge, and lets the UI demote/hide weak matches
 * — so the searched-for game leads and is visibly indicated, while page chrome
 * that survived the scrape filter sinks to the bottom. No network, no metadata
 * beyond the `title` + `url` we already have.
 */

/** How strongly an item matches the game-name query. */
export type MatchStrength = "strong" | "partial" | "none";

/** The structured query a result is scored against. `console`/`region` are
 *  optional ranking tokens — e.g. `console: "Super Nintendo SNES snes"`,
 *  `region: "USA"` — that boost the score but never gate match strength. */
export interface RankQuery {
  /** The game-name query terms (free text). */
  name: string;
  /** Console tokens to boost (display name + abbreviation + key, space-joined). */
  console?: string;
  /** Region label to boost (e.g. "USA"). */
  region?: string;
}

/** Minimal shape the ranker needs from a result. */
export interface Rankable {
  title: string;
  url: string;
}

/** Region labels offered in the structured-search region select. Mirrors the
 *  regions recognized by {@link parseBadges}; the label is both the dropdown
 *  option and the ranking/compose token. */
export const SEARCH_REGIONS: readonly string[] = [
  "USA", "Europe", "Japan", "World", "UK", "Germany", "France",
  "Spain", "Italy", "Australia", "Korea", "China", "Brazil", "Canada",
];

// Score weights — kept small and explicit so ordering is predictable/testable.
const W_TERM = 10; // per matched name term
const W_FULL = 50; // all name terms present (dominates partial matches)
const W_PREFIX = 5; // title begins with the first name term
const W_CONSOLE = 8; // a console token appears in the result
const W_REGION = 4; // the region token appears in the result

/** Lowercase alphanumeric tokens of `s`. */
function tokens(s: string): string[] {
  return s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/** How many of `terms` appear in `haystack` (as a whole token or a substring,
 *  so "mario" still matches "supermario"). */
function matchedCount(terms: string[], hayTokens: Set<string>, haystack: string): number {
  let n = 0;
  for (const t of terms) {
    if (hayTokens.has(t) || haystack.includes(t)) n++;
  }
  return n;
}

/** Build the lowercase haystack (title + url) for an item. */
function haystackOf(item: Rankable): string {
  return `${item.title} ${item.url}`.toLowerCase();
}

/** Score `item` against `query`. Higher = more relevant. Pure. */
export function scoreItem(item: Rankable, query: RankQuery): number {
  const nameTerms = tokens(query.name);
  if (nameTerms.length === 0) return 0;

  const haystack = haystackOf(item);
  const hayTokens = new Set(tokens(haystack));
  const matched = matchedCount(nameTerms, hayTokens, haystack);

  let score = matched * W_TERM;
  if (matched === nameTerms.length) score += W_FULL;
  if (item.title.toLowerCase().startsWith(nameTerms[0])) score += W_PREFIX;

  if (query.console) {
    const consoleTokens = tokens(query.console);
    if (consoleTokens.some((t) => hayTokens.has(t) || haystack.includes(t))) {
      score += W_CONSOLE;
    }
  }
  if (query.region) {
    const region = query.region.toLowerCase();
    if (region && haystack.includes(region)) score += W_REGION;
  }
  return score;
}

/** Classify how strongly `item` matches the game name. Independent of
 *  console/region, so a legit result whose title omits the console is never
 *  demoted to `none`. */
export function matchStrength(item: Rankable, query: RankQuery): MatchStrength {
  const nameTerms = tokens(query.name);
  if (nameTerms.length === 0) return "none";
  const haystack = haystackOf(item);
  const hayTokens = new Set(tokens(haystack));
  const matched = matchedCount(nameTerms, hayTokens, haystack);
  if (matched === 0) return "none";
  if (matched === nameTerms.length) return "strong";
  return "partial";
}

/** Stably order `items` by descending relevance to `query`; ties keep their
 *  original (scrape) order, so this is "Relevance" sort. Pure (returns a new
 *  array). */
export function rankItems<T extends Rankable>(items: T[], query: RankQuery): T[] {
  return items
    .map((item, index) => ({ item, index, score: scoreItem(item, query) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
    .map((entry) => entry.item);
}
