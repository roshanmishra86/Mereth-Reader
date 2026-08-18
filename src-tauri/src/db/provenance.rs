//! Task 3.2 — provenance discipline (PRD §16.1).
//!
//! Every text-bearing feature record carries exactly **one** of the six
//! provenance values, enforced at the schema level by a CHECK on each table
//! (this is a schema rule, not a presentation rule). This module is the
//! Rust-side counterpart: it validates provenance before any write and it
//! implements the one rule the schema expresses as a paired column —
//! **adoption never erases the original provenance** (FR-12.12, §16.1).
//!
//! When a user explicitly adopts an AI draft, the record's `provenance`
//! becomes `user_adopted_ai` and its `original_provenance` keeps the value it
//! had before adoption (typically `ai_draft`). Subsequent edits keep both,
//! so downstream consumers can always distinguish an adopted draft from
//! user-authored text and from a still-unadopted draft.
//!
//! The SQL spellings of the CHECK expressions live here as constants so the
//! migration (m9), the Rust validators, and the schema tests cannot drift
//! apart.

/// The six provenance values of §16.1. Ordered as in the R0.3 constraint.
pub const ALLOWED_PROVENANCES: &[&str] = &[
  "source_extracted",
  "source_ocr",
  "user_authored",
  "ai_draft",
  "user_adopted_ai",
  "deterministic_transform",
];

/// The provenance a record gets once the user explicitly adopts a draft.
pub const ADOPTED_PROVENANCE: &str = "user_adopted_ai";

/// SQL literal-list spelling of the six values, shared by the CHECK
/// expressions below (and therefore by migration 9).
pub const PROVENANCE_VALUES_SQL: &str =
  "('source_extracted', 'source_ocr', 'user_authored', 'ai_draft', 'user_adopted_ai', 'deterministic_transform')";

/// CHECK expression for `original_provenance`: NULL (never adopted) or one of
/// the six provenance values.
pub const ORIGINAL_PROVENANCE_SET_CHECK: &str = "original_provenance IS NULL OR original_provenance IN ('source_extracted', 'source_ocr', 'user_authored', 'ai_draft', 'user_adopted_ai', 'deterministic_transform')";

/// CHECK expression pairing adoption with a preserved original: a row whose
/// provenance is `user_adopted_ai` must carry a non-NULL original that is not
/// itself an adoption. This is the schema-level embodiment of "adoption never
/// erases the original provenance".
pub const ADOPTION_CONSISTENCY_CHECK: &str = "provenance <> 'user_adopted_ai' OR (original_provenance IS NOT NULL AND original_provenance <> 'user_adopted_ai')";

/// The R2–R4 feature tables created in migrations 4–8. Task 3.2 (migration 9)
/// adds `original_provenance` + the adoption checks to each of them.
pub const TEXT_BEARING_FEATURE_TABLES: &[&str] = &[
  "annotations",
  "annotation_assets",
  "notes",
  "note_revisions",
  "note_links",
  "evidence_blocks",
  "review_prompts",
  "review_events",
  "review_schedule",
  "exports",
];

/// The R0.3-era text-bearing tables. They already carry the six-value
/// provenance CHECK (migration 1) and are listed here so the schema-wide test
/// pins the whole §16.1 surface, old and new. Adoption does not apply to
/// extraction records, so they do not get `original_provenance`.
pub const CORE_TEXT_BEARING_TABLES: &[&str] = &["documents", "document_versions", "pages"];

/// Validates that `provenance` is exactly one of the six §16.1 values.
pub fn validate_provenance(provenance: &str) -> Result<(), String> {
  if ALLOWED_PROVENANCES.contains(&provenance) {
    Ok(())
  } else {
    Err(format!(
      "Invalid provenance '{provenance}'; expected one of {ALLOWED_PROVENANCES:?}"
    ))
  }
}

/// Computes the `(provenance, original_provenance)` pair for an explicit
/// adoption (FR-11.5 "explicitly adopts it", FR-12.12 adopted state).
///
/// `previous` is the record's provenance **before** adoption. Returns
/// `("user_adopted_ai", previous)` and rejects inputs that would erase
/// history: a value outside the six (including the empty string) or an
/// already-adopted value (an adoption must always trace back to a
/// non-adopted original; a re-adoption keeps the first original).
pub fn adoption_provenance(previous: &str) -> Result<(String, String), String> {
  validate_provenance(previous)?;
  if previous == ADOPTED_PROVENANCE {
    return Err(
      "Adoption cannot erase a prior adoption: original_provenance must be the value before the first adoption"
        .to_string(),
    );
  }
  Ok((ADOPTED_PROVENANCE.to_string(), previous.to_string()))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_validate_provenance_accepts_exactly_the_six_values() {
    for value in ALLOWED_PROVENANCES {
      assert!(validate_provenance(value).is_ok(), "{value} must be accepted");
      // Case matters: provenance is a controlled vocabulary.
      assert!(validate_provenance(&value.to_uppercase()).is_err());
    }

    for bad in ["", "fabricated", "user_edited", "none", "ai_generated", "source"] {
      assert!(validate_provenance(bad).is_err(), "{bad} must be rejected");
    }
  }

  #[test]
  fn test_adoption_preserves_the_original_value() {
    // Adopting any non-adopted provenance yields the adopted pair whose
    // original is exactly the pre-adoption value.
    for previous in ALLOWED_PROVENANCES
      .iter()
      .filter(|p| **p != ADOPTED_PROVENANCE)
    {
      let (provenance, original) = adoption_provenance(previous).expect("valid adoption");
      assert_eq!(provenance, "user_adopted_ai");
      assert_eq!(original, *previous);
    }
  }

  #[test]
  fn test_adoption_rejects_values_that_would_erase_history() {
    // Re-adopting an already-adopted draft must not lose the first original.
    assert!(adoption_provenance("user_adopted_ai").is_err());
    // Anything outside the six values is not a traceable original.
    assert!(adoption_provenance("").is_err());
    assert!(adoption_provenance("fabricated").is_err());
  }

  #[test]
  fn test_check_expressions_spell_the_same_vocabulary() {
    // The SQL spellings must mention exactly the six values; guard against
    // a silent typo drifting from the Rust vocabulary.
    for value in ALLOWED_PROVENANCES {
      assert!(PROVENANCE_VALUES_SQL.contains(value));
      assert!(ORIGINAL_PROVENANCE_SET_CHECK.contains(value));
    }
    assert!(ORIGINAL_PROVENANCE_SET_CHECK.contains("original_provenance IS NULL OR"));
    assert!(ADOPTION_CONSISTENCY_CHECK.contains("original_provenance IS NOT NULL"));
    assert!(ADOPTION_CONSISTENCY_CHECK.contains("original_provenance <> 'user_adopted_ai'"));
  }
}
