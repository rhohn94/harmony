/**
 * Tests for resultRanking (W182 / v0.18 "Focus").
 *
 * The ranker is pure and framework-free, so it is exercised directly in node:
 * scoring, match-strength classification, and stable relevance ordering.
 */
import { describe, it, expect } from "vitest";
import {
  scoreItem,
  matchStrength,
  rankItems,
  SEARCH_REGIONS,
} from "./resultRanking";
import type { RankQuery } from "./resultRanking";

const item = (title: string, url = "https://x.example.com/" + title) => ({ title, url });

describe("scoreItem", () => {
  it("scores a full-coverage match above a partial one", () => {
    const q: RankQuery = { name: "super mario" };
    const full = scoreItem(item("Super Mario Bros. (USA)"), q);
    const partial = scoreItem(item("Mario Paint"), q);
    const none = scoreItem(item("Donkey Kong Country"), q);
    expect(full).toBeGreaterThan(partial);
    expect(partial).toBeGreaterThan(none);
    expect(none).toBe(0);
  });

  it("returns 0 when the query name has no terms", () => {
    expect(scoreItem(item("Anything"), { name: "   " })).toBe(0);
  });

  it("adds a console bonus when a console token appears", () => {
    const base: RankQuery = { name: "zelda" };
    const withConsole: RankQuery = { name: "zelda", console: "Nintendo 64 N64 n64" };
    const it1 = item("Legend of Zelda (N64)");
    expect(scoreItem(it1, withConsole)).toBeGreaterThan(scoreItem(it1, base));
  });

  it("adds a region bonus when the region appears", () => {
    const base: RankQuery = { name: "contra" };
    const withRegion: RankQuery = { name: "contra", region: "USA" };
    const it1 = item("Contra (USA)");
    expect(scoreItem(it1, withRegion)).toBeGreaterThan(scoreItem(it1, base));
  });

  it("matches a term as a substring (supermario contains mario)", () => {
    expect(scoreItem(item("supermario.zip"), { name: "mario" })).toBeGreaterThan(0);
  });
});

describe("matchStrength", () => {
  const q: RankQuery = { name: "super mario" };

  it("is strong when all name terms are present", () => {
    expect(matchStrength(item("Super Mario Bros. 3 (USA)"), q)).toBe("strong");
  });

  it("is partial when only some name terms are present", () => {
    expect(matchStrength(item("Mario Paint"), q)).toBe("partial");
  });

  it("is none when no name terms are present", () => {
    expect(matchStrength(item("Donkey Kong Country"), q)).toBe("none");
  });

  it("is none for an empty query name", () => {
    expect(matchStrength(item("Whatever"), { name: "" })).toBe("none");
  });

  it("does not gate on console/region (title without console is still strong)", () => {
    const withConsole: RankQuery = { name: "mario", console: "SNES snes" };
    expect(matchStrength(item("Mario Bros. (USA)"), withConsole)).toBe("strong");
  });
});

describe("rankItems", () => {
  it("orders by descending relevance, strong matches first", () => {
    const items = [
      item("Donkey Kong Country (USA)"),
      item("Mario Paint (Japan)"),
      item("Super Mario Bros. (USA)"),
    ];
    const ranked = rankItems(items, { name: "super mario" });
    expect(ranked.map((r) => r.title)).toEqual([
      "Super Mario Bros. (USA)",
      "Mario Paint (Japan)",
      "Donkey Kong Country (USA)",
    ]);
  });

  it("is stable: equal scores keep original order", () => {
    const items = [item("Mario A"), item("Mario B"), item("Mario C")];
    const ranked = rankItems(items, { name: "mario" });
    expect(ranked.map((r) => r.title)).toEqual(["Mario A", "Mario B", "Mario C"]);
  });

  it("returns a new array without mutating the input", () => {
    const items = [item("b"), item("a")];
    const copy = [...items];
    rankItems(items, { name: "a" });
    expect(items).toEqual(copy);
  });
});

describe("SEARCH_REGIONS", () => {
  it("offers the common regions", () => {
    expect(SEARCH_REGIONS).toContain("USA");
    expect(SEARCH_REGIONS).toContain("Japan");
    expect(SEARCH_REGIONS).toContain("Europe");
  });
});
