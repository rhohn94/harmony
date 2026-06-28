//! Console-metadata cache repository (v0.12): one upsert row per console for the
//! Wikipedia-sourced photo path + description + article URL. Static console facts
//! (name, maker, generation) are NOT stored here — they live in
//! `core/console/catalog.rs`; this caches only the network-fetched bits.

use super::{map_sqlite, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, OptionalExtension, Row};

/// A cached `console_meta` row.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ConsoleMeta {
    pub key: String,
    pub description: Option<String>,
    pub wikipedia_url: Option<String>,
    pub image_path: Option<String>,
    pub fetched_at: i64,
}

/// Repository over the `console_meta` cache table.
pub struct ConsoleMetaRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for ConsoleMetaRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_meta(row: &Row) -> rusqlite::Result<ConsoleMeta> {
    Ok(ConsoleMeta {
        key: row.get("key")?,
        description: row.get("description")?,
        wikipedia_url: row.get("wikipedia_url")?,
        image_path: row.get("image_path")?,
        fetched_at: row.get("fetched_at")?,
    })
}

impl ConsoleMetaRepo<'_> {
    /// Fetch a console's cached metadata, or `None` if never fetched.
    pub fn get(&self, key: &str) -> AppResult<Option<ConsoleMeta>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM console_meta WHERE key = ?1",
                params![key],
                map_meta,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// Insert or replace a console's cached metadata (keyed by `key`).
    pub fn upsert(
        &self,
        key: &str,
        description: Option<&str>,
        wikipedia_url: Option<&str>,
        image_path: Option<&str>,
        fetched_at: i64,
    ) -> AppResult<()> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO console_meta (key, description, wikipedia_url, image_path, fetched_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5) \
                 ON CONFLICT(key) DO UPDATE SET \
                   description = excluded.description, \
                   wikipedia_url = excluded.wikipedia_url, \
                   image_path = excluded.image_path, \
                   fetched_at = excluded.fetched_at",
                params![key, description, wikipedia_url, image_path, fetched_at],
            )
            .map_err(map_sqlite)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_then_get_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = ConsoleMetaRepo::new(&db);
        assert!(repo.get("nes").unwrap().is_none());

        repo.upsert(
            "nes",
            Some("An 8-bit console."),
            Some("https://en.wikipedia.org/wiki/Nintendo_Entertainment_System"),
            Some("/art/nes.png"),
            123,
        )
        .unwrap();

        let got = repo.get("nes").unwrap().unwrap();
        assert_eq!(got.description.as_deref(), Some("An 8-bit console."));
        assert_eq!(got.image_path.as_deref(), Some("/art/nes.png"));
        assert_eq!(got.fetched_at, 123);
    }

    #[test]
    fn upsert_replaces_existing() {
        let db = Db::open_in_memory().unwrap();
        let repo = ConsoleMetaRepo::new(&db);
        repo.upsert("snes", Some("old"), None, None, 1).unwrap();
        repo.upsert("snes", Some("new"), None, Some("/p.png"), 2).unwrap();
        let got = repo.get("snes").unwrap().unwrap();
        assert_eq!(got.description.as_deref(), Some("new"));
        assert_eq!(got.image_path.as_deref(), Some("/p.png"));
        assert_eq!(got.fetched_at, 2);
    }
}
