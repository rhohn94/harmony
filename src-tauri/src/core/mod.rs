//! Domain logic modules — pure, no Tauri types, unit-testable in isolation.
//! Each domain work item adds ONE `pub mod <domain>;` line here (append-only).
//! Master contract: architecture-design.md §1.2.

pub mod search; // W9 — provider model + template substitution
// --- APPEND DOMAIN MODULES BELOW THIS LINE ---
