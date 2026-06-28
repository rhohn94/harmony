-- 005_game_description_and_rom_providers.sql (v0.12 "Curator")
--
-- Two additive changes, both safe metadata-only operations:
--
-- 1. Library enrichment (feature: auto-download metadata on add). Games gain a
--    Wikipedia-sourced `description` and the canonical article `wikipedia_url`.
--    Existing rows stay NULL; the enrichment command populates them on add /
--    refresh. ALTER TABLE ADD COLUMN is a cheap metadata-only change.
ALTER TABLE games ADD COLUMN description   TEXT;  -- Wikipedia summary (nullable)
ALTER TABLE games ADD COLUMN wikipedia_url TEXT;  -- canonical article URL (nullable)

-- 2. ROM-site download providers (feature: emulator ROM sites in download
--    search). Seeded as kind='download' so the Search UI groups + marks them
--    with the ⬇ download badge (downloads.ts).
--
-- CONTRACT (unchanged, file-search-design.md §2): Harmony ships no game content,
-- never auto-downloads, and only constructs a {query} link the user opens in
-- their OWN browser. These are well-known emulation/ROM sites; Harmony never
-- fetches from them and the user can disable, remove, or add their own. Each
-- template was verified to resolve and to honor the {query} search parameter.
INSERT OR IGNORE INTO search_providers (name, url_template, enabled, kind) VALUES
  ('RomsGames', 'https://www.romsgames.net/?s={query}',                 1, 'download'),
  ('Romspedia', 'https://romspedia.com/search?term={query}',            1, 'download'),
  ('RomsFun',   'https://www.romsfun.com/?s={query}',                   1, 'download'),
  ('WoWROMs',   'https://wowroms.com/en/roms/list?search={query}',      1, 'download');
