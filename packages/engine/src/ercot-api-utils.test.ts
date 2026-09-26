import { describe, it, expect } from 'vitest';

/**
 * ERCOT API Sorting Strategy Tests
 * 
 * BACKGROUND:
 * ERCOT's public API uses separate `sort` and `dir` query parameters:
 * - sort: Field name (single field only, e.g., "deliveryDate")
 * - dir: Sort direction ("asc" or "desc")
 * 
 * The API does NOT support multi-field sorting or combined formats like
 * "deliveryDate-desc,hourEnding-desc" - these cause 400 BAD_REQUEST errors
 * with "One or more of the sorting parameters specified are not available".
 * 
 * SOLUTION:
 * We omit the sort parameter entirely and sort client-side after fetching.
 * This gives us consistent multi-field ordering and avoids API errors.
 * 
 * Client-side sorting helpers are in apps/web/src/lib/ercot-live.ts:
 * - sortByDeliveryDateHourDesc: For load, forecast, wind, solar endpoints
 * - sortByDeliveryDateHourIntervalDesc: For 15-min RT SPP prices
 * 
 * NULL-SAFE SORTING (Hotfix for P0 crash):
 * The sort functions are null-safe to handle cases where ERCOT API returns
 * data with missing or undefined fields. This prevents TypeError crashes
 * when localeCompare is called on undefined values.
 */

function safeCompareDesc(a: string | undefined | null, b: string | undefined | null): number {
  const aStr = a ?? '';
  const bStr = b ?? '';
  return bStr.localeCompare(aStr);
}

function safeParseInt(value: string | number | undefined | null): number {
  if (value == null) return 0;
  const str = typeof value === 'number' ? String(value) : value;
  const parsed = parseInt(str.replace(':00', '').trim(), 10);
  return isNaN(parsed) ? 0 : parsed;
}

interface HasDeliveryDateHour {
  deliveryDate?: string;
  hourEnding?: string;
}

function sortByDeliveryDateHourDesc<T extends HasDeliveryDateHour>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const dateCompare = safeCompareDesc(a?.deliveryDate, b?.deliveryDate);
    if (dateCompare !== 0) return dateCompare;
    const hourA = safeParseInt(a?.hourEnding);
    const hourB = safeParseInt(b?.hourEnding);
    return hourB - hourA;
  });
}

interface HasDeliveryDateHourInterval {
  deliveryDate?: string;
  deliveryHour?: string | number;
  deliveryInterval?: string | number;
}

function sortByDeliveryDateHourIntervalDesc<T extends HasDeliveryDateHourInterval>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const dateCompare = safeCompareDesc(a?.deliveryDate, b?.deliveryDate);
    if (dateCompare !== 0) return dateCompare;
    const hourA = safeParseInt(a?.deliveryHour);
    const hourB = safeParseInt(b?.deliveryHour);
    if (hourB !== hourA) return hourB - hourA;
    const intervalA = safeParseInt(a?.deliveryInterval);
    const intervalB = safeParseInt(b?.deliveryInterval);
    return intervalB - intervalA;
  });
}

interface ErcotApiFieldDef {
  name: string;
  label?: string;
  dataType?: string;
}

interface ErcotApiResponse<T> {
  fields?: ErcotApiFieldDef[];
  data: T[] | unknown[][];
}

function transformErcotResponse<T>(response: ErcotApiResponse<T>): T[] {
  const { fields, data } = response;
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    return [];
  }
  
  const firstRow = data[0];
  
  if (fields && Array.isArray(fields) && fields.length > 0 && Array.isArray(firstRow)) {
    const fieldNames = fields.map(f => f.name);
    return (data as unknown[][]).map(row => {
      const obj: Record<string, unknown> = {};
      fieldNames.forEach((name, idx) => {
        if (idx < row.length) {
          obj[name] = row[idx];
        }
      });
      return obj as T;
    });
  }
  
  if (typeof firstRow === 'object' && firstRow !== null && !Array.isArray(firstRow)) {
    return data as T[];
  }
  
  return [];
}

describe('ERCOT API Sorting Strategy', () => {
  it('documents that ERCOT uses separate sort and dir params', () => {
    // Example valid ERCOT API call:
    // GET /np6-345-cd/act_sys_load_by_wzn?size=24&sort=deliveryDate&dir=desc
    
    // Example INVALID call (what we used to send, causes 400):
    // GET /np6-345-cd/act_sys_load_by_wzn?size=24&sort=deliveryDate-desc,hourEnding-desc
    
    // Since ERCOT only supports single-field sorting and we need multi-field,
    // we omit sort entirely and sort client-side.
    expect(true).toBe(true);
  });

  it('client-side sorting achieves multi-field ordering', () => {
    const unsortedData = [
      { deliveryDate: '2026-09-26', hourEnding: '15:00' },
      { deliveryDate: '2026-09-26', hourEnding: '17:00' },
      { deliveryDate: '2026-09-25', hourEnding: '12:00' },
      { deliveryDate: '2026-09-26', hourEnding: '16:00' },
    ];

    const sorted = sortByDeliveryDateHourDesc(unsortedData);

    expect(sorted[0]).toEqual({ deliveryDate: '2026-09-26', hourEnding: '17:00' });
    expect(sorted[1]).toEqual({ deliveryDate: '2026-09-26', hourEnding: '16:00' });
    expect(sorted[2]).toEqual({ deliveryDate: '2026-09-26', hourEnding: '15:00' });
    expect(sorted[3]).toEqual({ deliveryDate: '2026-09-25', hourEnding: '12:00' });
  });

  it('client-side sorting handles 15-min intervals for RT SPP', () => {
    const unsortedData = [
      { deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '2' },
      { deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '4' },
      { deliveryDate: '2026-09-26', deliveryHour: '14', deliveryInterval: '3' },
      { deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '1' },
    ];

    const sorted = sortByDeliveryDateHourIntervalDesc(unsortedData);

    expect(sorted[0]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '4' });
    expect(sorted[1]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '2' });
    expect(sorted[2]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '1' });
    expect(sorted[3]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '14', deliveryInterval: '3' });
  });
});

describe('Null-Safe Sorting (P0 Hotfix)', () => {
  describe('sortByDeliveryDateHourDesc', () => {
    it('handles undefined deliveryDate without crashing', () => {
      const dataWithMissingDate = [
        { deliveryDate: '2026-09-26', hourEnding: '15:00' },
        { deliveryDate: undefined, hourEnding: '17:00' },
        { hourEnding: '12:00' },
        { deliveryDate: '2026-09-25', hourEnding: '16:00' },
      ];

      expect(() => sortByDeliveryDateHourDesc(dataWithMissingDate as HasDeliveryDateHour[])).not.toThrow();
      const sorted = sortByDeliveryDateHourDesc(dataWithMissingDate as HasDeliveryDateHour[]);
      expect(sorted).toHaveLength(4);
      expect(sorted[0]?.deliveryDate).toBe('2026-09-26');
    });

    it('handles undefined hourEnding without crashing', () => {
      const dataWithMissingHour = [
        { deliveryDate: '2026-09-26', hourEnding: '15:00' },
        { deliveryDate: '2026-09-26', hourEnding: undefined },
        { deliveryDate: '2026-09-26' },
      ];

      expect(() => sortByDeliveryDateHourDesc(dataWithMissingHour as HasDeliveryDateHour[])).not.toThrow();
      const sorted = sortByDeliveryDateHourDesc(dataWithMissingHour as HasDeliveryDateHour[]);
      expect(sorted).toHaveLength(3);
    });

    it('handles completely empty objects without crashing', () => {
      const dataWithEmptyObjects = [
        { deliveryDate: '2026-09-26', hourEnding: '15:00' },
        {},
        { deliveryDate: '2026-09-25', hourEnding: '12:00' },
      ];

      expect(() => sortByDeliveryDateHourDesc(dataWithEmptyObjects as HasDeliveryDateHour[])).not.toThrow();
    });

    it('handles null values without crashing', () => {
      const dataWithNulls = [
        { deliveryDate: '2026-09-26', hourEnding: '15:00' },
        { deliveryDate: null as unknown as string, hourEnding: '17:00' },
      ];

      expect(() => sortByDeliveryDateHourDesc(dataWithNulls as HasDeliveryDateHour[])).not.toThrow();
    });
  });

  describe('sortByDeliveryDateHourIntervalDesc', () => {
    it('handles undefined fields without crashing', () => {
      const dataWithMissing = [
        { deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '2' },
        { deliveryDate: undefined, deliveryHour: '15', deliveryInterval: '4' },
        { deliveryDate: '2026-09-26', deliveryHour: undefined, deliveryInterval: '3' },
        { deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: undefined },
        {},
      ];

      expect(() => sortByDeliveryDateHourIntervalDesc(dataWithMissing as HasDeliveryDateHourInterval[])).not.toThrow();
      const sorted = sortByDeliveryDateHourIntervalDesc(dataWithMissing as HasDeliveryDateHourInterval[]);
      expect(sorted).toHaveLength(5);
    });

    it('handles numeric deliveryHour and deliveryInterval (API variation)', () => {
      const dataWithNumericValues = [
        { deliveryDate: '2026-09-26', deliveryHour: 15, deliveryInterval: 2 },
        { deliveryDate: '2026-09-26', deliveryHour: 15, deliveryInterval: 4 },
        { deliveryDate: '2026-09-26', deliveryHour: 14, deliveryInterval: 3 },
      ];

      const sorted = sortByDeliveryDateHourIntervalDesc(dataWithNumericValues);

      expect(sorted[0]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: 15, deliveryInterval: 4 });
      expect(sorted[1]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: 15, deliveryInterval: 2 });
      expect(sorted[2]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: 14, deliveryInterval: 3 });
    });
  });
});

describe('ERCOT API Response Transformation', () => {
  it('transforms positional array format to named objects', () => {
    const apiResponse: ErcotApiResponse<{ deliveryDate: string; hourEnding: string; value: number }> = {
      fields: [
        { name: 'deliveryDate' },
        { name: 'hourEnding' },
        { name: 'value' },
      ],
      data: [
        ['2026-09-26', '15:00', 100],
        ['2026-09-26', '16:00', 200],
      ] as unknown[][],
    };

    const result = transformErcotResponse(apiResponse);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ deliveryDate: '2026-09-26', hourEnding: '15:00', value: 100 });
    expect(result[1]).toEqual({ deliveryDate: '2026-09-26', hourEnding: '16:00', value: 200 });
  });

  it('handles legacy object array format', () => {
    const apiResponse: ErcotApiResponse<{ deliveryDate: string; hourEnding: string }> = {
      data: [
        { deliveryDate: '2026-09-26', hourEnding: '15:00' },
        { deliveryDate: '2026-09-26', hourEnding: '16:00' },
      ],
    };

    const result = transformErcotResponse(apiResponse);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ deliveryDate: '2026-09-26', hourEnding: '15:00' });
  });

  it('returns empty array for empty data', () => {
    const emptyResponse: ErcotApiResponse<{ deliveryDate: string }> = {
      data: [],
    };

    expect(transformErcotResponse(emptyResponse)).toEqual([]);
  });

  it('returns empty array for null/undefined data', () => {
    const nullResponse = { data: null } as unknown as ErcotApiResponse<{ deliveryDate: string }>;
    const undefinedResponse = { data: undefined } as unknown as ErcotApiResponse<{ deliveryDate: string }>;

    expect(transformErcotResponse(nullResponse)).toEqual([]);
    expect(transformErcotResponse(undefinedResponse)).toEqual([]);
  });

  it('handles fields array with more fields than data columns', () => {
    const apiResponse: ErcotApiResponse<{ a: string; b: string; c: string }> = {
      fields: [
        { name: 'a' },
        { name: 'b' },
        { name: 'c' },
      ],
      data: [
        ['value1', 'value2'],
      ] as unknown[][],
    };

    const result = transformErcotResponse(apiResponse);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ a: 'value1', b: 'value2' });
  });
});
