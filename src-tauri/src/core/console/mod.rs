//! Console catalog domain (v0.12).
//!
//! Three decoupled concerns:
//!   - [`catalog`] — static, in-code metadata for every covered console
//!     (display name, maker, generation, debut year, Wikipedia title).
//!   - [`titles`]  — the bundled per-console list of known game titles
//!     (generated from libretro-database, embedded in the binary).
//!   - [`media`]   — fetch + cache a console's Wikipedia photo + description.
//!
//! Powers the "By Console" browse + detail view via `commands/console.rs`.

pub mod catalog;
pub mod media;
pub mod titles;

pub use catalog::ConsoleInfo;
