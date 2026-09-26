import { describe, it, expect } from 'vitest';
import { encodeErcotSort } from './ercot-api-utils.js';

/**
 * Tests for ERCOT API utility functions.
 * 
 * ERCOT's public API has strict requirements for query parameters:
 * - sort parameter only accepts: 0-9, a-z, A-Z, underscore (_), dash (-), comma (,)
 * - Spaces cause 400 BAD_REQUEST
 */

describe('ERCOT API Utils', () => {
  describe('encodeErcotSort', () => {
    it('replaces spaces with dashes for single field', () => {
      const result = encodeErcotSort(['deliveryDate desc']);
      expect(result).toBe('deliveryDate-desc');
    });

    it('replaces spaces with dashes for multiple fields', () => {
      const result = encodeErcotSort(['deliveryDate desc', 'hourEnding desc']);
      expect(result).toBe('deliveryDate-desc,hourEnding-desc');
    });

    it('handles three-field sort (SPP prices)', () => {
      const result = encodeErcotSort([
        'deliveryDate desc',
        'deliveryHour desc',
        'deliveryInterval desc',
      ]);
      expect(result).toBe('deliveryDate-desc,deliveryHour-desc,deliveryInterval-desc');
    });

    it('result contains only ERCOT-valid characters', () => {
      const result = encodeErcotSort([
        'deliveryDate desc',
        'hourEnding asc',
      ]);
      
      const validChars = /^[0-9a-zA-Z_\-,]+$/;
      expect(result).toMatch(validChars);
      expect(result).not.toContain(' ');
      expect(result).not.toContain('+');
    });

    it('handles empty array', () => {
      const result = encodeErcotSort([]);
      expect(result).toBe('');
    });

    it('collapses multiple spaces to single dash', () => {
      const result = encodeErcotSort(['delivery  date   desc']);
      expect(result).toBe('delivery-date-desc');
      expect(result).not.toContain(' ');
    });

    it('passes through fields already without spaces', () => {
      const result = encodeErcotSort(['deliveryDate-desc', 'hourEnding-asc']);
      expect(result).toBe('deliveryDate-desc,hourEnding-asc');
    });

    it('handles ascending sort', () => {
      const result = encodeErcotSort(['deliveryDate asc']);
      expect(result).toBe('deliveryDate-asc');
    });
  });
});
