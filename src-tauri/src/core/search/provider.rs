//! Search-provider model for the core layer (W9).
//!
//! Mirrors the `SearchProvider` and `SearchResult` TS DTOs from the master
//! contract (architecture-design.md §2.5). The persistence layer
//! (`db::repo::search_providers`) owns the SQL; this module owns the types and
//! the business rules (e.g. template validation).

use crate::error::{AppError, AppResult};

/// A search provider as returned by IPC commands.
///
/// Ships with the list **empty** — users add providers manually. The `enabled`
/// flag lets a provider be hidden from `run_search` without deletion.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SearchProvider {
    pub id: i64,
    pub name: String,
    /// URL template containing the `{query}` placeholder (percent-encoded at
    /// substitution time). Example: `https://duckduckgo.com/?q={query}`.
    pub url_template: String,
    pub enabled: bool,
    /// Provider category: `"reference"` or `"download"` (v0.11).
    pub kind: String,
}

/// A single search result link the UI opens in the system browser.
///
/// Note: the live IPC preview path (v0.16) is modelled by
/// `commands::search::ProviderResults` / `SearchResultItem`, which carry the
/// scraped per-item title + URL. This core type is the original link-only shape
/// kept for reference; the backend previews provider result pages but never
/// downloads the content itself.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct SearchResult {
    pub provider_id: i64,
    pub provider_name: String,
    pub title: String,
    /// The fully-constructed URL — open in the system browser.
    pub url: String,
}

/// Validate that a URL template contains the `{query}` placeholder and is
/// non-empty. Returns `Err(AppError::Validation)` on any violation.
pub fn validate_template(url_template: &str) -> AppResult<()> {
    if url_template.trim().is_empty() {
        return Err(AppError::Validation(
            "url_template must not be empty".to_string(),
        ));
    }
    if !url_template.contains("{query}") {
        return Err(AppError::Validation(
            "url_template must contain the {query} placeholder".to_string(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty() {
        assert!(matches!(
            validate_template(""),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            validate_template("   "),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_rejects_missing_placeholder() {
        assert!(matches!(
            validate_template("https://example.com/search"),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn validate_accepts_valid_template() {
        assert!(validate_template("https://example.com/search?q={query}").is_ok());
    }
}
