//! Native play IPC (v0.21 "Bedrock") — start/stop a native libretro core
//! session and pull decoded RGBA frames for the frontend's `<canvas>`.
//! Mirrors `commands::play`'s shape (in-page EmulatorJS) but for the native
//! hosting path; see docs/design/native-emulation-design.md §3/§4. Input
//! delivery (W216) and the EmulatorJS-fallback flag (W215) build on top of
//! this — this module is frame delivery only.

use crate::db::repo::library::LibraryRepo;
use crate::db::repo::Repository;
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::play::native;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Holds the single in-flight native session, if any. Harmony only ever
/// plays one game natively at a time; starting a new session replaces (and,
/// via `NativeRuntime`'s `Drop`, stops) whatever was running.
#[derive(Default)]
pub struct NativeSession(Mutex<Option<native::NativeRuntime>>);

/// A decoded RGBA frame, base64-encoded for the JSON IPC boundary — mirrors
/// the project's existing image-over-IPC convention (`vibrancy`'s blurred-hero
/// data URI).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFrameDto {
    pub width: u32,
    pub height: u32,
    /// Base64-encoded RGBA8888 bytes, `width * height * 4` long once decoded.
    pub rgba_base64: String,
}

fn lock(session: &NativeSession) -> std::sync::MutexGuard<'_, Option<native::NativeRuntime>> {
    session.0.lock().unwrap_or_else(|p| p.into_inner())
}

/// Starts a native session for `game_id`, replacing any session already
/// running. Resolves the installed `fceumm` core path (W213) and the game's
/// ROM path (the library row), then spawns the runtime (W212).
#[tauri::command]
pub fn start_native_play(
    game_id: i64,
    db: State<'_, Db>,
    session: State<'_, NativeSession>,
) -> AppResult<()> {
    let game = LibraryRepo::new(&db).get_game(game_id)?;
    if game.system != native::NATIVE_SYSTEM {
        return Err(AppError::Unsupported(format!(
            "native hosting only supports {} — game {} is {}",
            native::NATIVE_SYSTEM,
            game_id,
            game.system
        )));
    }
    let core_path = native::resolve_native_core_path(&db)?;
    let rom_path = PathBuf::from(&game.path);
    let runtime = native::NativeRuntime::start(&core_path, &rom_path)?;
    *lock(&session) = Some(runtime);
    Ok(())
}

/// Stops the in-flight native session, if any. A no-op if nothing is running.
#[tauri::command]
pub fn stop_native_play(session: State<'_, NativeSession>) -> AppResult<()> {
    lock(&session).take();
    Ok(())
}

/// The most recently produced frame, base64-encoded RGBA — or `None` if no
/// session is running or the core hasn't produced a frame yet. Polled by the
/// frontend on an animation-frame cadence (`NativePlayer.tsx`, W214).
#[tauri::command]
pub fn get_native_frame(session: State<'_, NativeSession>) -> AppResult<Option<NativeFrameDto>> {
    Ok(lock(&session).as_ref().and_then(native::NativeRuntime::latest_frame).map(|frame| {
        NativeFrameDto {
            width: frame.width,
            height: frame.height,
            rgba_base64: BASE64.encode(&frame.data),
        }
    }))
}
