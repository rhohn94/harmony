//! Console media fetch + cache (v0.12).
//!
//! Resolves a console's photo + description from Wikipedia (by its exact article
//! title) and caches the result: the description/URL go in the `console_meta`
//! table, the image bytes are written under `console-art/<key>.<ext>`. Mirrors
//! the cover-art cache's shape (network + DB, async, best-effort). A fetch
//! failure leaves the console uncached so a later call retries.

use super::catalog::ConsoleInfo;
use crate::config::paths::Paths;
use crate::core::metadata::wikipedia;
use crate::db::repo::console_meta::{ConsoleMeta, ConsoleMetaRepo};
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::AppResult;
use std::time::{SystemTime, UNIX_EPOCH};

/// Return a console's cached media, fetching it from Wikipedia on a cache miss.
/// Best-effort: when Wikipedia has nothing (or is unreachable) this returns
/// `Ok(None)` and writes no cache row, so a future call can retry.
pub async fn ensure_console_media(
    db: &Db,
    paths: &Paths,
    console: &ConsoleInfo,
) -> AppResult<Option<ConsoleMeta>> {
    let repo = ConsoleMetaRepo::new(db);
    if let Some(cached) = repo.get(console.key)? {
        return Ok(Some(cached));
    }

    // Fetch the article summary directly by its known title.
    let Some(summary) = wikipedia::fetch_summary_by_title(console.wikipedia_title)
        .await
        .ok()
        .flatten()
    else {
        return Ok(None);
    };

    // Cache the lead image alongside, if present.
    let image_path = match &summary.thumbnail_url {
        Some(url) => download_image(paths, console.key, url).await,
        None => None,
    };

    repo.upsert(
        console.key,
        Some(&summary.extract),
        summary.page_url.as_deref(),
        image_path.as_deref(),
        epoch_secs(),
    )?;
    repo.get(console.key)
}

/// Download the console photo and write it under `console-art/<key>.<ext>`,
/// returning the on-disk path. Any failure yields `None` (description-only cache).
async fn download_image(paths: &Paths, key: &str, url: &str) -> Option<String> {
    let bytes = wikipedia::fetch_image_bytes(url).await.ok().flatten()?;
    let dir = paths.console_art_dir().ok()?;
    let ext = image_ext(url);
    let dest = dir.join(format!("{key}.{ext}"));
    std::fs::write(&dest, &bytes).ok()?;
    dest.to_str().map(|s| s.to_string())
}

/// Pick a safe lowercase image extension from a URL, defaulting to `png`.
fn image_ext(url: &str) -> String {
    let raw = url.rsplit('.').next().unwrap_or("png");
    let cleaned: String = raw
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    match cleaned.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" => cleaned,
        _ => "png".to_string(),
    }
}

/// Current Unix epoch seconds.
fn epoch_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_ext_picks_known_extensions() {
        assert_eq!(image_ext("https://x/300px-NES.png"), "png");
        assert_eq!(image_ext("https://x/photo.JPG"), "jpg");
        assert_eq!(image_ext("https://x/logo.svg.png"), "png");
        assert_eq!(image_ext("https://x/weird"), "png");
        assert_eq!(image_ext("https://x/a.bmp"), "png"); // unsupported → default
    }

    #[test]
    fn cached_media_short_circuits_network() {
        // Pre-seed the cache; ensure_console_media must return it without any
        // network call (the test has no network and must not error).
        let tmp = tempfile::tempdir().unwrap();
        let paths = Paths::with_root(tmp.path().join("harmony")).unwrap();
        let db = Db::open_in_memory().unwrap();
        ConsoleMetaRepo::new(&db)
            .upsert("nes", Some("cached"), None, None, 1)
            .unwrap();
        let console = super::super::catalog::get("nes").unwrap();
        let got = tauri::async_runtime::block_on(ensure_console_media(&db, &paths, console))
            .unwrap()
            .unwrap();
        assert_eq!(got.description.as_deref(), Some("cached"));
    }
}
