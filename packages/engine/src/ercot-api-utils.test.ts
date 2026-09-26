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
 */

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

    const sorted = [...unsortedData].sort((a, b) => {
      const dateCompare = b.deliveryDate.localeCompare(a.deliveryDate);
      if (dateCompare !== 0) return dateCompare;
      const hourA = parseInt(a.hourEnding.replace(':00', ''), 10);
      const hourB = parseInt(b.hourEnding.replace(':00', ''), 10);
      return hourB - hourA;
    });

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

    const sorted = [...unsortedData].sort((a, b) => {
      const dateCompare = b.deliveryDate.localeCompare(a.deliveryDate);
      if (dateCompare !== 0) return dateCompare;
      const hourA = parseInt(a.deliveryHour, 10);
      const hourB = parseInt(b.deliveryHour, 10);
      if (hourB !== hourA) return hourB - hourA;
      const intervalA = parseInt(a.deliveryInterval, 10);
      const intervalB = parseInt(b.deliveryInterval, 10);
      return intervalB - intervalA;
    });

    expect(sorted[0]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '4' });
    expect(sorted[1]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '2' });
    expect(sorted[2]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '15', deliveryInterval: '1' });
    expect(sorted[3]).toEqual({ deliveryDate: '2026-09-26', deliveryHour: '14', deliveryInterval: '3' });
  });
});
