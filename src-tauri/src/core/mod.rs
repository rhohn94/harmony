//! Core business-logic modules (platform-agnostic, no Tauri dependencies).
//! Each sub-module owns one functional domain; the command layer in
//! `src/commands/` wraps these for the IPC surface.

pub mod launch; // W7 — RetroArch locate + arg builder + spawn
