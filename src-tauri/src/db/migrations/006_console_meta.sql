-- 006_console_meta.sql (v0.12 "Curator")
-- Cache for per-console Wikipedia media: the photo (downloaded under
-- console-art/) and the summary text + canonical article URL. The console's
-- static facts (name, maker, generation, year) live in code
-- (core/console/catalog.rs); only the fetched, cacheable bits live here. Keyed
-- by the console system key so it is a one-row-per-console upsert cache.
CREATE TABLE IF NOT EXISTS console_meta (
  key           TEXT PRIMARY KEY,   -- console system key (e.g. 'nes')
  description   TEXT,               -- Wikipedia summary text (nullable)
  wikipedia_url TEXT,               -- canonical article URL (nullable)
  image_path    TEXT,               -- cached console photo on disk (nullable)
  fetched_at    INTEGER NOT NULL    -- Unix epoch of the last successful fetch
);
