/**
 * ERCOT API Utility Functions
 * 
 * Helpers for interacting with ERCOT public API.
 */

/**
 * Encode sort parameter for ERCOT API.
 * 
 * ERCOT only accepts these characters in sort params:
 * - 0-9, a-z, A-Z, underscore (_), dash (-), and comma (,)
 * 
 * Spaces are NOT allowed. This function replaces spaces with dashes.
 * 
 * @example
 * encodeErcotSort(['deliveryDate desc', 'hourEnding desc'])
 * // Returns: 'deliveryDate-desc,hourEnding-desc'
 * 
 * @param sortFields Array of sort fields (e.g., ['deliveryDate desc', 'hourEnding desc'])
 * @returns Encoded sort string safe for ERCOT API
 */
export function encodeErcotSort(sortFields: string[]): string {
  return sortFields
    .map(field => field.replace(/\s+/g, '-'))
    .join(',');
}
