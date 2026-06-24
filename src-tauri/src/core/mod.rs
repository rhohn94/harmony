//! Pure, Tauri-free domain logic (architecture-design.md §1.2). Each domain has
//! its own subdir under `core/`; command adapters in `commands/` call into it.
//! Modules here never import Tauri types so every function is unit-testable.

pub mod library; // W6 — folder walk, ROM hashing, DAT parse/match, system mapping
