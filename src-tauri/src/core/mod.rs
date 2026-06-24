//! Domain logic root (architecture-design.md §1.2). Each `core/<domain>`
//! submodule holds pure, testable business logic; the thin `commands/<domain>.rs`
//! adapters call into it and map results onto the unified `AppError`. Backend
//! work items append their `pub mod <domain>;` line below.

pub mod familiar; // W12 — two-stage Familiar probe + Keychain key + enrich client
// --- APPEND CORE DOMAIN MODULES BELOW THIS LINE ---
