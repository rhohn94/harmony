//! Library repository (W3): CRUD for `content_folders` and `games`.
//!
//! Folders own games via a cascading FK, so deleting a folder removes its games.
//! Row shapes mirror the `ContentFolder` / `Game` TS DTOs (architecture §2).

use super::{map_sqlite, require_affected, require_found, Repository};
use crate::db::Db;
use crate::error::AppResult;
use rusqlite::{params, OptionalExtension, Row};

/// A scanned content folder (`content_folders` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct ContentFolder {
    pub id: i64,
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

/// A game/ROM entry (`games` row).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Game {
    pub id: i64,
    pub folder_id: i64,
    pub path: String,
    pub system: String,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
    /// Release year, if known (W61; nullable — populated by future enrichment).
    pub year: Option<i64>,
    /// Developer / studio, if known (W61; nullable).
    pub developer: Option<String>,
    /// Publisher, if known (W61; nullable).
    pub publisher: Option<String>,
    /// Alternate titles as a JSON array string, if known (W61; nullable).
    pub aliases: Option<String>,
    /// Wikipedia summary text, if fetched (v0.12 enrichment; nullable).
    pub description: Option<String>,
    /// Canonical Wikipedia article URL, if known (v0.12 enrichment; nullable).
    pub wikipedia_url: Option<String>,
}

/// New-folder input (no id; assigned by SQLite).
pub struct NewContentFolder {
    pub path: String,
    pub enabled: bool,
    pub added_at: i64,
}

/// New-game input (no id; assigned by SQLite).
pub struct NewGame {
    pub folder_id: i64,
    pub path: String,
    pub system: String,
    pub crc32: Option<String>,
    pub md5: Option<String>,
    pub clean_name: String,
    pub dat_matched: bool,
    pub core_hint: Option<String>,
    pub art_path: Option<String>,
    pub size_bytes: i64,
    pub added_at: i64,
    /// Optional metadata (W61). Defaults to `None` from a scan (no enrichment yet).
    pub year: Option<i64>,
    pub developer: Option<String>,
    pub publisher: Option<String>,
    pub aliases: Option<String>,
}

/// Repository over the library tables.
pub struct LibraryRepo<'a> {
    db: &'a Db,
}

impl<'a> Repository<'a> for LibraryRepo<'a> {
    fn new(db: &'a Db) -> Self {
        Self { db }
    }
    fn db(&self) -> &Db {
        self.db
    }
}

fn map_folder(row: &Row) -> rusqlite::Result<ContentFolder> {
    Ok(ContentFolder {
        id: row.get("id")?,
        path: row.get("path")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        added_at: row.get("added_at")?,
    })
}

fn map_game(row: &Row) -> rusqlite::Result<Game> {
    Ok(Game {
        id: row.get("id")?,
        folder_id: row.get("folder_id")?,
        path: row.get("path")?,
        system: row.get("system")?,
        crc32: row.get("crc32")?,
        md5: row.get("md5")?,
        clean_name: row.get("clean_name")?,
        dat_matched: row.get::<_, i64>("dat_matched")? != 0,
        core_hint: row.get("core_hint")?,
        art_path: row.get("art_path")?,
        size_bytes: row.get("size_bytes")?,
        added_at: row.get("added_at")?,
        year: row.get("year")?,
        developer: row.get("developer")?,
        publisher: row.get("publisher")?,
        aliases: row.get("aliases")?,
        description: row.get("description")?,
        wikipedia_url: row.get("wikipedia_url")?,
    })
}

impl LibraryRepo<'_> {
    // --- content_folders ---

    /// Insert a content folder, returning its assigned id.
    pub fn add_folder(&self, folder: &NewContentFolder) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO content_folders (path, enabled, added_at) VALUES (?1, ?2, ?3)",
                params![folder.path, folder.enabled as i64, folder.added_at],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a folder by id (NotFound if absent).
    pub fn get_folder(&self, id: i64) -> AppResult<ContentFolder> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM content_folders WHERE id = ?1",
                params![id],
                map_folder,
            )
            .map_err(require_found)
        })
    }

    /// Fetch a folder by its exact path, or `None` if not registered. Uses the
    /// `content_folders.path` UNIQUE index — O(log n), not a full scan.
    pub fn get_folder_by_path(&self, path: &str) -> AppResult<Option<ContentFolder>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM content_folders WHERE path = ?1",
                params![path],
                map_folder,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// List all folders ordered by id.
    pub fn list_folders(&self) -> AppResult<Vec<ContentFolder>> {
        self.db.with_conn(|c| {
            let mut stmt = c
                .prepare("SELECT * FROM content_folders ORDER BY id")
                .map_err(map_sqlite)?;
            let rows = stmt
                .query_map([], map_folder)
                .map_err(map_sqlite)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(map_sqlite)?;
            Ok(rows)
        })
    }

    /// Toggle a folder's enabled flag (NotFound if absent).
    pub fn set_folder_enabled(&self, id: i64, enabled: bool) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE content_folders SET enabled = ?1 WHERE id = ?2",
                    params![enabled as i64, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a folder (cascades to its games). NotFound if absent.
    pub fn delete_folder(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM content_folders WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    // --- games ---

    /// Insert a game, returning its assigned id.
    pub fn add_game(&self, game: &NewGame) -> AppResult<i64> {
        self.db.with_conn(|c| {
            c.execute(
                "INSERT INTO games (folder_id, path, system, crc32, md5, clean_name, \
                 dat_matched, core_hint, art_path, size_bytes, added_at, \
                 year, developer, publisher, aliases) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    game.folder_id,
                    game.path,
                    game.system,
                    game.crc32,
                    game.md5,
                    game.clean_name,
                    game.dat_matched as i64,
                    game.core_hint,
                    game.art_path,
                    game.size_bytes,
                    game.added_at,
                    game.year,
                    game.developer,
                    game.publisher,
                    game.aliases,
                ],
            )
            .map_err(map_sqlite)?;
            Ok(c.last_insert_rowid())
        })
    }

    /// Fetch a game by id (NotFound if absent).
    pub fn get_game(&self, id: i64) -> AppResult<Game> {
        self.db.with_conn(|c| {
            c.query_row("SELECT * FROM games WHERE id = ?1", params![id], map_game)
                .map_err(require_found)
        })
    }

    /// Fetch a game by its exact stored path, or `None`. Uses the `games.path`
    /// UNIQUE index — O(log n), not a full table scan.
    pub fn get_game_by_path(&self, path: &str) -> AppResult<Option<Game>> {
        self.db.with_conn(|c| {
            c.query_row("SELECT * FROM games WHERE path = ?1", params![path], map_game)
                .optional()
                .map_err(map_sqlite)
        })
    }

    /// Find a game already in the library by its content hash + system (the
    /// import dedup key — re-importing the same ROM, even from a different
    /// location or filename, resolves to the existing row). Uses `idx_games_crc32`.
    pub fn find_game_by_hash(&self, crc32: &str, system: &str) -> AppResult<Option<Game>> {
        self.db.with_conn(|c| {
            c.query_row(
                "SELECT * FROM games WHERE crc32 = ?1 AND system = ?2 LIMIT 1",
                params![crc32, system],
                map_game,
            )
            .optional()
            .map_err(map_sqlite)
        })
    }

    /// List games, optionally filtered by system. `None` lists all.
    pub fn list_games(&self, system: Option<&str>) -> AppResult<Vec<Game>> {
        self.db.with_conn(|c| {
            let collect = |stmt: &mut rusqlite::Statement, p: &[&dyn rusqlite::ToSql]| {
                stmt.query_map(p, map_game)
                    .map_err(map_sqlite)?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(map_sqlite)
            };
            match system {
                Some(s) => {
                    let mut stmt = c
                        .prepare("SELECT * FROM games WHERE system = ?1 ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[&s])
                }
                None => {
                    let mut stmt = c
                        .prepare("SELECT * FROM games ORDER BY id")
                        .map_err(map_sqlite)?;
                    collect(&mut stmt, &[])
                }
            }
        })
    }

    /// Update a game's denormalized display art path (NotFound if absent).
    pub fn set_game_art(&self, id: i64, art_path: Option<&str>) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET art_path = ?1 WHERE id = ?2",
                    params![art_path, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Update a game's `clean_name` (W12 Familiar enrichment writes the
    /// disambiguated title here). NotFound if absent.
    pub fn set_game_clean_name(&self, id: i64, clean_name: &str) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET clean_name = ?1 WHERE id = ?2",
                    params![clean_name, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Persist Wikipedia-sourced enrichment (description + canonical article URL)
    /// for a game. Either field may be `None` to leave/clear it. NotFound if the
    /// game is absent. Art is set separately via [`Self::set_game_art`].
    pub fn set_game_enrichment(
        &self,
        id: i64,
        description: Option<&str>,
        wikipedia_url: Option<&str>,
    ) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute(
                    "UPDATE games SET description = ?1, wikipedia_url = ?2 WHERE id = ?3",
                    params![description, wikipedia_url, id],
                )
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }

    /// Delete a game (cascades to its art_cache rows). NotFound if absent.
    pub fn delete_game(&self, id: i64) -> AppResult<()> {
        self.db.with_conn(|c| {
            let n = c
                .execute("DELETE FROM games WHERE id = ?1", params![id])
                .map_err(map_sqlite)?;
            require_affected(n)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppError;

    fn folder(path: &str) -> NewContentFolder {
        NewContentFolder {
            path: path.to_string(),
            enabled: true,
            added_at: 100,
        }
    }

    fn game(folder_id: i64, path: &str) -> NewGame {
        NewGame {
            folder_id,
            path: path.to_string(),
            system: "nes".to_string(),
            crc32: Some("deadbeef".to_string()),
            md5: None,
            clean_name: "Super Game".to_string(),
            dat_matched: true,
            core_hint: Some("mesen".to_string()),
            art_path: None,
            size_bytes: 4096,
            added_at: 200,
            year: None,
            developer: None,
            publisher: None,
            aliases: None,
        }
    }

    #[test]
    fn folder_crud_roundtrip() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let id = repo.add_folder(&folder("/roms")).unwrap();
        let got = repo.get_folder(id).unwrap();
        assert_eq!(got.path, "/roms");
        assert!(got.enabled);
        repo.set_folder_enabled(id, false).unwrap();
        assert!(!repo.get_folder(id).unwrap().enabled);
        assert_eq!(repo.list_folders().unwrap().len(), 1);
        repo.delete_folder(id).unwrap();
        assert!(matches!(repo.get_folder(id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn duplicate_folder_path_is_conflict() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        repo.add_folder(&folder("/roms")).unwrap();
        assert!(matches!(
            repo.add_folder(&folder("/roms")),
            Err(AppError::Conflict(_))
        ));
    }

    #[test]
    fn game_crud_and_cascade() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap();
        assert_eq!(repo.get_game(gid).unwrap().clean_name, "Super Game");
        repo.set_game_art(gid, Some("/art/a.png")).unwrap();
        assert_eq!(
            repo.get_game(gid).unwrap().art_path.as_deref(),
            Some("/art/a.png")
        );
        assert_eq!(repo.list_games(Some("nes")).unwrap().len(), 1);
        assert_eq!(repo.list_games(Some("snes")).unwrap().len(), 0);
        assert_eq!(repo.list_games(None).unwrap().len(), 1);
        // Deleting the folder cascades to the game.
        repo.delete_folder(fid).unwrap();
        assert!(matches!(repo.get_game(gid), Err(AppError::NotFound(_))));
    }

    #[test]
    fn game_metadata_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let mut g = game(fid, "/roms/meta.nes");
        g.year = Some(1990);
        g.developer = Some("Nintendo R&D4".to_string());
        g.publisher = Some("Nintendo".to_string());
        g.aliases = Some(r#"["Mario 3","SMB3"]"#.to_string());
        let gid = repo.add_game(&g).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert_eq!(got.year, Some(1990));
        assert_eq!(got.developer.as_deref(), Some("Nintendo R&D4"));
        assert_eq!(got.publisher.as_deref(), Some("Nintendo"));
        assert_eq!(got.aliases.as_deref(), Some(r#"["Mario 3","SMB3"]"#));
    }

    #[test]
    fn scanned_game_has_null_metadata() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/plain.nes")).unwrap();
        let got = repo.get_game(gid).unwrap();
        assert!(got.year.is_none());
        assert!(got.developer.is_none());
        assert!(got.publisher.is_none());
        assert!(got.aliases.is_none());
    }

    #[test]
    fn enrichment_round_trips() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/enrich.nes")).unwrap();
        // A scanned game starts with no description.
        assert!(repo.get_game(gid).unwrap().description.is_none());
        repo.set_game_enrichment(
            gid,
            Some("A platformer about a plumber."),
            Some("https://en.wikipedia.org/wiki/Super_Mario_Bros."),
        )
        .unwrap();
        let got = repo.get_game(gid).unwrap();
        assert_eq!(got.description.as_deref(), Some("A platformer about a plumber."));
        assert_eq!(
            got.wikipedia_url.as_deref(),
            Some("https://en.wikipedia.org/wiki/Super_Mario_Bros.")
        );
    }

    #[test]
    fn set_enrichment_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(
            repo.set_game_enrichment(999, Some("x"), None),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn lookup_by_path_and_hash() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        let fid = repo.add_folder(&folder("/roms")).unwrap();
        let gid = repo.add_game(&game(fid, "/roms/a.nes")).unwrap(); // crc deadbeef, nes
        // by path
        assert_eq!(repo.get_game_by_path("/roms/a.nes").unwrap().unwrap().id, gid);
        assert!(repo.get_game_by_path("/roms/missing.nes").unwrap().is_none());
        // by hash + system (the import dedup key)
        assert_eq!(repo.find_game_by_hash("deadbeef", "nes").unwrap().unwrap().id, gid);
        assert!(repo.find_game_by_hash("deadbeef", "snes").unwrap().is_none());
        assert!(repo.find_game_by_hash("00000000", "nes").unwrap().is_none());
        // folder by path
        assert_eq!(repo.get_folder_by_path("/roms").unwrap().unwrap().id, fid);
        assert!(repo.get_folder_by_path("/nope").unwrap().is_none());
    }

    #[test]
    fn delete_missing_game_is_not_found() {
        let db = Db::open_in_memory().unwrap();
        let repo = LibraryRepo::new(&db);
        assert!(matches!(repo.delete_game(999), Err(AppError::NotFound(_))));
    }
}
