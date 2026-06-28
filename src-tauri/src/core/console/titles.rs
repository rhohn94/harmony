//! Bundled per-console title catalog (v0.12).
//!
//! The "By Console" detail view browses every known title for a console. Those
//! lists are generated from the community libretro-database datfiles (game NAMES
//! only — Harmony ships no game content) by `scripts/build-console-catalog.mjs`,
//! committed under `resources/catalog/<system>.json`, and embedded into the
//! binary here via `include_dir!` so lookups are offline and need no resource-path
//! resolution. Each file is `{ "system", "titles": ["Canonical Title", …] }`,
//! already de-duplicated and sorted.
//!
//! This module is pure (no DB): it loads, searches, and paginates the embedded
//! lists. Ownership cross-referencing (which titles the user has in their
//! library) is layered on by the command adapter, which has the DB.

use include_dir::{include_dir, Dir};
use std::collections::HashMap;
use std::sync::OnceLock;

/// The embedded catalog directory (compiled into the binary).
static CATALOG_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/resources/catalog");

/// Shape of a `<system>.json` catalog file (only `titles` is read).
#[derive(serde::Deserialize)]
struct CatalogFile {
    titles: Vec<String>,
}

/// Parse + memoize every embedded catalog file into `system → titles` once.
fn all() -> &'static HashMap<String, Vec<String>> {
    static ALL: OnceLock<HashMap<String, Vec<String>>> = OnceLock::new();
    ALL.get_or_init(|| {
        let mut map = HashMap::new();
        for file in CATALOG_DIR.files() {
            let system = file.path().file_stem().and_then(|s| s.to_str());
            let text = file.contents_utf8();
            if let (Some(system), Some(text)) = (system, text) {
                if let Ok(parsed) = serde_json::from_str::<CatalogFile>(text) {
                    map.insert(system.to_string(), parsed.titles);
                }
            }
        }
        map
    })
}

/// The full title list for a system (empty when no catalog is bundled).
pub fn titles_for(system: &str) -> &'static [String] {
    all().get(system).map(|v| v.as_slice()).unwrap_or(&[])
}

/// Number of distinct catalog titles bundled for a system.
pub fn count(system: &str) -> usize {
    titles_for(system).len()
}

/// Normalize a title into a loose **ownership-matching key**. Both the bundled
/// catalog title and the user's library `clean_name` pass through this, so the
/// key only needs to be *consistent*, not pretty. It:
///   1. drops parenthesized/bracketed tag groups (region/revision/proto/…),
///   2. lowercases and splits on every non-alphanumeric boundary, so punctuation
///      and separator differences (`.`/`:`/`-`/`,`) never block a match,
///   3. drops leading articles (`the`/`a`/`an`) as whole words — reconciling
///      No-Intro's sort-suffix convention ("Legend of Zelda, The") with the
///      natural form ("The Legend of Zelda").
///
/// Example: both "The Legend of Zelda: A Link to the Past" and
/// "Legend of Zelda, The - A Link to the Past (USA)" → "legend of zelda link to past".
pub fn normalize(name: &str) -> String {
    // 1. strip () and [] tag groups (handles nesting).
    let mut stripped = String::with_capacity(name.len());
    let mut depth = 0i32;
    for ch in name.chars() {
        match ch {
            '(' | '[' => depth += 1,
            ')' | ']' => {
                if depth > 0 {
                    depth -= 1
                }
            }
            _ if depth == 0 => stripped.push(ch),
            _ => {}
        }
    }
    // 2/3. lowercase, tokenize on non-alphanumerics, drop article words.
    stripped
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty() && !matches!(*t, "the" | "a" | "an"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// A page of catalog titles for `system`, filtered by an optional case-insensitive
/// substring `query`. Returns `(total_matching, page)` where `page` honors
/// `offset`/`limit`. Titles stay in their sorted order.
pub fn search(
    system: &str,
    query: Option<&str>,
    offset: usize,
    limit: usize,
) -> (usize, Vec<&'static str>) {
    let titles = titles_for(system);
    let needle = query
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());

    let matched: Vec<&'static str> = match &needle {
        Some(n) => titles
            .iter()
            .filter(|t| t.to_lowercase().contains(n))
            .map(|s| s.as_str())
            .collect(),
        None => titles.iter().map(|s| s.as_str()).collect(),
    };
    let total = matched.len();
    let page = matched.into_iter().skip(offset).take(limit).collect();
    (total, page)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_console_key_has_a_bundled_catalog() {
        // Each static console must have a non-empty embedded title list.
        for c in crate::core::console::catalog::all() {
            assert!(
                count(c.key) > 0,
                "console '{}' has no bundled title catalog",
                c.key
            );
        }
    }

    #[test]
    fn nes_catalog_is_large_and_sorted() {
        let titles = titles_for("nes");
        assert!(titles.len() > 1000, "expected a large NES catalog");
        // Sorted case-insensitively by the generator.
        let mut prev = String::new();
        for t in titles.iter().take(50) {
            assert!(t.to_lowercase() >= prev, "catalog not sorted at {t}");
            prev = t.to_lowercase();
        }
    }

    #[test]
    fn unknown_system_is_empty() {
        assert_eq!(count("not_a_system"), 0);
        let (total, page) = search("not_a_system", None, 0, 10);
        assert_eq!(total, 0);
        assert!(page.is_empty());
    }

    #[test]
    fn search_filters_and_paginates() {
        // Query for a common term and page through it.
        let (total, page) = search("nes", Some("mario"), 0, 5);
        assert!(total > 0, "expected NES Mario titles");
        assert!(page.len() <= 5);
        for t in &page {
            assert!(t.to_lowercase().contains("mario"));
        }
        // Offset past the page boundary returns the next slice.
        let (_total2, page2) = search("nes", Some("mario"), 5, 5);
        if total > 5 {
            assert!(!page2.is_empty());
            assert_ne!(page.first(), page2.first());
        }
    }

    #[test]
    fn empty_query_returns_all_paged() {
        let (total, page) = search("n64", None, 0, 25);
        assert_eq!(total, count("n64"));
        assert!(page.len() <= 25);
    }

    #[test]
    fn normalize_strips_tags_and_lowercases() {
        assert_eq!(normalize("Super Mario Bros. (USA)"), "super mario bros");
        assert_eq!(normalize("Chrono Trigger (USA) (Rev 1)"), "chrono trigger");
        assert_eq!(normalize("Sonic [!]"), "sonic");
    }

    #[test]
    fn normalize_reconciles_article_convention_and_punctuation() {
        // The No-Intro sort-suffix form and the natural form yield the same key,
        // so a user who owns "The Legend of Zelda" matches the catalog's
        // "Legend of Zelda, The".
        assert_eq!(normalize("The Legend of Zelda"), normalize("Legend of Zelda, The"));
        assert_eq!(
            normalize("The Legend of Zelda: A Link to the Past"),
            normalize("Legend of Zelda, The - A Link to the Past (USA)"),
        );
        assert_eq!(normalize("The Legend of Zelda"), "legend of zelda");
    }
}
