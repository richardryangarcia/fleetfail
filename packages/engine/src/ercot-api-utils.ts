/**
 * ERCOT API Utility Functions
 * 
 * Helpers for interacting with ERCOT public API.
 * 
 * SORTING STRATEGY:
 * ERCOT's API uses separate `sort` and `dir` parameters and only supports
 * single-field sorting. To achieve consistent multi-field ordering and avoid
 * 400 errors from invalid sort parameters, we omit sort params entirely and
 * sort client-side after fetching. See ercot-live.ts for the sorting helpers.
 */

// Note: encodeErcotSort was removed in favor of client-side sorting.
// ERCOT API sort param format is `sort=fieldName&dir=asc|desc` (single field only).
// Our previous format `sort=field-dir,field-dir` was invalid and caused 400 errors.
