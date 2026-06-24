//! Harmony backend library crate. `main.rs` is a thin shim calling `run()`.
//! The app builder registers the full IPC surface via the append-only
//! `register_commands!` macro (see `commands/mod.rs`). Master contract §1.2.

pub mod commands;
pub mod db; // W3 — SQLite persistence (handle, migrations, repos)
pub mod error;

use tauri::Manager;

/// One-time app setup hook. Later items wire config load, telemetry, and the
/// fleet server here (W4/W11). W3 wires db open + migrate.
///
/// Each item adds its own block below the marker and stays append-friendly so
/// W2/W4 merge by concatenation. W3's block opens the database under app-support
/// (running migrations) and stores the `Db` handle in Tauri app state.
fn harmony_setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // --- W3: database ---
    // W4 SEAM: `db::default_db_path()` uses a local minimal app-support resolver;
    // swap it for W4's `config::paths` resolver when that lands (see db/mod.rs).
    let db_path = db::default_db_path()?;
    let database = db::Db::open(&db_path)?;
    app.manage(database);
    // --- APPEND FURTHER SETUP BLOCKS BELOW THIS LINE (W4/W11) ---
    Ok(())
}

/// Build, register commands, and run the Harmony application.
pub fn run() {
    let builder = tauri::Builder::default().setup(harmony_setup);

    // The macro is the ONLY place the invoke_handler is assembled; domain items
    // append their commands inside it (commands/mod.rs), never here.
    register_commands!(builder)
        .run(tauri::generate_context!())
        .expect("error while running Harmony");
}
