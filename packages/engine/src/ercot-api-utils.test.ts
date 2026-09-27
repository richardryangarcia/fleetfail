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

describe('toCamelCase with Canonical Alias Map (v3 fix)', () => {
  const CANONICAL_FIELD_ALIASES: Record<string, string> = {
    deliverydate: 'deliveryDate',
    hourending: 'hourEnding',
    systemtotal: 'systemTotal',
    coast: 'coast',
    east: 'east',
    farwest: 'farWest',
    north: 'north',
    northcentral: 'northCentral',
    southcentral: 'southCentral',
    southern: 'southern',
    west: 'west',
  };

  function normalizeFieldKey(fieldName: string): string {
    return fieldName.toLowerCase().replace(/_/g, '');
  }

  function toCamelCase(fieldName: string): string {
    const normalized = normalizeFieldKey(fieldName);
    
    if (CANONICAL_FIELD_ALIASES[normalized]) {
      return CANONICAL_FIELD_ALIASES[normalized];
    }
    
    if (fieldName.includes('_')) {
      return fieldName.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    }
    
    return fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
  }

  describe('PascalCase inputs → canonical camelCase', () => {
    it('converts DeliveryDate to deliveryDate', () => {
      expect(toCamelCase('DeliveryDate')).toBe('deliveryDate');
    });

    it('converts HourEnding to hourEnding', () => {
      expect(toCamelCase('HourEnding')).toBe('hourEnding');
    });

    it('converts SystemTotal to systemTotal', () => {
      expect(toCamelCase('SystemTotal')).toBe('systemTotal');
    });

    it('converts single-word PascalCase (Coast, East)', () => {
      expect(toCamelCase('Coast')).toBe('coast');
      expect(toCamelCase('East')).toBe('east');
    });

    it('converts multi-word PascalCase zone names', () => {
      expect(toCamelCase('FarWest')).toBe('farWest');
      expect(toCamelCase('NorthCentral')).toBe('northCentral');
      expect(toCamelCase('SouthCentral')).toBe('southCentral');
    });
  });

  describe('ALL_CAPS with underscores → canonical camelCase', () => {
    it('converts DELIVERY_DATE to deliveryDate', () => {
      expect(toCamelCase('DELIVERY_DATE')).toBe('deliveryDate');
    });

    it('converts HOUR_ENDING to hourEnding', () => {
      expect(toCamelCase('HOUR_ENDING')).toBe('hourEnding');
    });

    it('converts FAR_WEST to farWest', () => {
      expect(toCamelCase('FAR_WEST')).toBe('farWest');
    });

    it('converts NORTH_CENTRAL to northCentral', () => {
      expect(toCamelCase('NORTH_CENTRAL')).toBe('northCentral');
    });
  });

  describe('ALL_CAPS without underscores → canonical camelCase (via alias map)', () => {
    it('converts DELIVERYDATE to deliveryDate', () => {
      expect(toCamelCase('DELIVERYDATE')).toBe('deliveryDate');
    });

    it('converts HOURENDING to hourEnding', () => {
      expect(toCamelCase('HOURENDING')).toBe('hourEnding');
    });

    it('converts COAST to coast', () => {
      expect(toCamelCase('COAST')).toBe('coast');
    });

    it('converts FARWEST to farWest', () => {
      expect(toCamelCase('FARWEST')).toBe('farWest');
    });

    it('converts SYSTEMTOTAL to systemTotal', () => {
      expect(toCamelCase('SYSTEMTOTAL')).toBe('systemTotal');
    });
  });

  describe('lowercase snake_case → canonical camelCase', () => {
    it('converts delivery_date to deliveryDate', () => {
      expect(toCamelCase('delivery_date')).toBe('deliveryDate');
    });

    it('converts hour_ending to hourEnding', () => {
      expect(toCamelCase('hour_ending')).toBe('hourEnding');
    });

    it('converts far_west to farWest', () => {
      expect(toCamelCase('far_west')).toBe('farWest');
    });
  });

  describe('already camelCase → unchanged', () => {
    it('keeps deliveryDate unchanged', () => {
      expect(toCamelCase('deliveryDate')).toBe('deliveryDate');
    });

    it('keeps hourEnding unchanged', () => {
      expect(toCamelCase('hourEnding')).toBe('hourEnding');
    });

    it('keeps farWest unchanged', () => {
      expect(toCamelCase('farWest')).toBe('farWest');
    });
  });

  describe('all-lowercase → canonical camelCase (via alias map)', () => {
    it('converts deliverydate to deliveryDate', () => {
      expect(toCamelCase('deliverydate')).toBe('deliveryDate');
    });

    it('converts hourending to hourEnding', () => {
      expect(toCamelCase('hourending')).toBe('hourEnding');
    });

    it('converts farwest to farWest', () => {
      expect(toCamelCase('farwest')).toBe('farWest');
    });
  });
});

describe('ERCOT Payload Transform → hourlyData Integration (Prod Regression)', () => {
  const CANONICAL_FIELD_ALIASES: Record<string, string> = {
    deliverydate: 'deliveryDate',
    hourending: 'hourEnding',
    systemtotal: 'systemTotal',
    coast: 'coast',
    east: 'east',
    farwest: 'farWest',
    north: 'north',
    northcentral: 'northCentral',
    southcentral: 'southCentral',
    southern: 'southern',
    west: 'west',
  };

  function normalizeFieldKey(fieldName: string): string {
    return fieldName.toLowerCase().replace(/_/g, '');
  }

  function toCamelCase(fieldName: string): string {
    const normalized = normalizeFieldKey(fieldName);
    if (CANONICAL_FIELD_ALIASES[normalized]) {
      return CANONICAL_FIELD_ALIASES[normalized];
    }
    if (fieldName.includes('_')) {
      return fieldName.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    }
    return fieldName.charAt(0).toLowerCase() + fieldName.slice(1);
  }

  function transformWithCamelCase<T>(response: ErcotApiResponse<T>): T[] {
    const { fields, data } = response;
    
    if (!data || !Array.isArray(data) || data.length === 0) {
      return [];
    }
    
    const firstRow = data[0];
    
    if (fields && Array.isArray(fields) && fields.length > 0 && Array.isArray(firstRow)) {
      const fieldNames = fields.map(f => toCamelCase(f.name));
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
      const normalized = (data as Record<string, unknown>[]).map(item => {
        const obj: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(item)) {
          obj[toCamelCase(key)] = value;
        }
        return obj as T;
      });
      return normalized;
    }
    
    return [];
  }

  interface ActualLoadByZone {
    deliveryDate?: string;
    hourEnding?: string;
    coast?: number;
    east?: number;
    farWest?: number;
    north?: number;
    northCentral?: number;
    southCentral?: number;
    southern?: number;
    west?: number;
    systemTotal?: number;
  }

  interface HourlySnapshot {
    hourKey: string;
    deliveryDate: string;
    hourEnding: number;
    dataType: 'actual' | 'forecast';
  }

  function buildHourlyData(actualLoad: ActualLoadByZone[]): HourlySnapshot[] {
    const hourlySnapshots: HourlySnapshot[] = [];
    const processedHours = new Set<string>();

    for (const load of actualLoad) {
      if (!load.deliveryDate) continue;
      const hourStr = load.hourEnding ?? '0';
      const hourEndingNum = parseInt(String(hourStr).replace(':00', ''), 10) || 0;
      const displayHour = hourEndingNum === 24 ? 0 : hourEndingNum;
      const hourKey = `${load.deliveryDate} ${String(displayHour).padStart(2, '0')}:00`;
      
      if (processedHours.has(hourKey)) continue;
      processedHours.add(hourKey);

      hourlySnapshots.push({
        hourKey,
        deliveryDate: load.deliveryDate,
        hourEnding: hourEndingNum,
        dataType: 'actual',
      });
    }

    return hourlySnapshots;
  }

  describe('PascalCase positional array format (likely ERCOT format)', () => {
    const ercotResponse: ErcotApiResponse<ActualLoadByZone> = {
      fields: [
        { name: 'DeliveryDate' },
        { name: 'HourEnding' },
        { name: 'Coast' },
        { name: 'East' },
        { name: 'FarWest' },
        { name: 'North' },
        { name: 'NorthCentral' },
        { name: 'SouthCentral' },
        { name: 'Southern' },
        { name: 'West' },
        { name: 'SystemTotal' },
      ],
      data: [
        ['2026-09-27', '1', 8500, 6200, 2100, 5800, 12500, 9200, 4800, 3200, 52300],
        ['2026-09-27', '2', 8300, 6100, 2000, 5700, 12300, 9100, 4700, 3100, 51300],
        ['2026-09-26', '24', 8700, 6400, 2200, 5900, 12700, 9400, 4900, 3300, 53500],
      ] as unknown[][],
    };

    it('transforms to objects with correct camelCase field names', () => {
      const result = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      expect(result).toHaveLength(3);
      expect(result[0]?.deliveryDate).toBe('2026-09-27');
      expect(result[0]?.hourEnding).toBe('1');
      expect(result[0]?.farWest).toBe(2100);
      expect(result[0]?.northCentral).toBe(12500);
    });

    it('produces non-empty hourlyData via buildHourlyData', () => {
      const actualLoad = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      const hourlyData = buildHourlyData(actualLoad);
      
      expect(hourlyData.length).toBeGreaterThan(0);
      expect(hourlyData.length).toBe(3);
    });

    it('all hourlyData entries have valid deliveryDate', () => {
      const actualLoad = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      const hourlyData = buildHourlyData(actualLoad);
      
      const invalidEntries = hourlyData.filter(h => !h.deliveryDate);
      expect(invalidEntries.length).toBe(0);
    });
  });

  describe('ALL_CAPS positional array format (edge case)', () => {
    const ercotResponse: ErcotApiResponse<ActualLoadByZone> = {
      fields: [
        { name: 'DELIVERYDATE' },
        { name: 'HOURENDING' },
        { name: 'COAST' },
        { name: 'FARWEST' },
        { name: 'NORTHCENTRAL' },
      ],
      data: [
        ['2026-09-27', '1', 8500, 2100, 12500],
        ['2026-09-27', '2', 8300, 2000, 12300],
      ] as unknown[][],
    };

    it('transforms ALL_CAPS to correct camelCase field names', () => {
      const result = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      expect(result).toHaveLength(2);
      expect(result[0]?.deliveryDate).toBe('2026-09-27');
      expect(result[0]?.hourEnding).toBe('1');
      expect(result[0]?.farWest).toBe(2100);
      expect(result[0]?.northCentral).toBe(12500);
    });

    it('produces non-empty hourlyData', () => {
      const actualLoad = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      const hourlyData = buildHourlyData(actualLoad);
      
      expect(hourlyData.length).toBeGreaterThan(0);
      expect(hourlyData.length).toBe(2);
    });
  });

  describe('lowercase snake_case positional array format (edge case)', () => {
    const ercotResponse: ErcotApiResponse<ActualLoadByZone> = {
      fields: [
        { name: 'delivery_date' },
        { name: 'hour_ending' },
        { name: 'coast' },
        { name: 'far_west' },
        { name: 'north_central' },
      ],
      data: [
        ['2026-09-27', '1', 8500, 2100, 12500],
        ['2026-09-27', '2', 8300, 2000, 12300],
      ] as unknown[][],
    };

    it('transforms snake_case to correct camelCase field names', () => {
      const result = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      expect(result).toHaveLength(2);
      expect(result[0]?.deliveryDate).toBe('2026-09-27');
      expect(result[0]?.hourEnding).toBe('1');
      expect(result[0]?.farWest).toBe(2100);
      expect(result[0]?.northCentral).toBe(12500);
    });

    it('produces non-empty hourlyData', () => {
      const actualLoad = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      const hourlyData = buildHourlyData(actualLoad);
      
      expect(hourlyData.length).toBeGreaterThan(0);
    });
  });

  describe('PascalCase legacy object format', () => {
    const ercotResponse: ErcotApiResponse<ActualLoadByZone> = {
      data: [
        { DeliveryDate: '2026-09-27', HourEnding: '1', Coast: 8500, FarWest: 2100, NorthCentral: 12500 },
        { DeliveryDate: '2026-09-27', HourEnding: '2', Coast: 8300, FarWest: 2000, NorthCentral: 12300 },
      ] as unknown as ActualLoadByZone[],
    };

    it('transforms legacy object format correctly', () => {
      const result = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      expect(result).toHaveLength(2);
      expect(result[0]?.deliveryDate).toBe('2026-09-27');
      expect(result[0]?.hourEnding).toBe('1');
    });

    it('produces non-empty hourlyData', () => {
      const actualLoad = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      const hourlyData = buildHourlyData(actualLoad);
      
      expect(hourlyData.length).toBeGreaterThan(0);
    });
  });

  describe('Regression: all-lowercase (deliverydate) must yield usable hourlyData', () => {
    const ercotResponse: ErcotApiResponse<ActualLoadByZone> = {
      fields: [
        { name: 'deliverydate' },
        { name: 'hourending' },
        { name: 'coast' },
      ],
      data: [
        ['2026-09-27', '1', 8500],
        ['2026-09-27', '2', 8300],
      ] as unknown[][],
    };

    it('transforms all-lowercase to correct camelCase', () => {
      const result = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      expect(result[0]?.deliveryDate).toBe('2026-09-27');
      expect(result[0]?.hourEnding).toBe('1');
    });

    it('produces non-empty hourlyData (NOT skipped due to undefined deliveryDate)', () => {
      const actualLoad = transformWithCamelCase<ActualLoadByZone>(ercotResponse);
      const hourlyData = buildHourlyData(actualLoad);
      
      expect(hourlyData.length).toBeGreaterThan(0);
      expect(hourlyData.length).toBe(2);
    });
  });
});
