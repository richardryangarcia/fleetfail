import { describe, it, expect } from 'vitest';
import {
  calculateArbWindows,
  createUnavailablePriceCache,
  ARB_EDGE_THRESHOLD_MWH,
  DEFAULT_SETTLEMENT_POINT,
  DAM_HORIZON_HOURS,
  type SppPrice,
} from './ercot-prices.js';

/**
 * ERCOT Settlement Point Price Tests
 * 
 * Tests use realistic price patterns based on ERCOT HB_HUBAVG data.
 * Real ERCOT prices typically range from $20-$80/MWh with occasional spikes.
 * 
 * Edge threshold: $5/MWh as per PRD
 */

describe('ERCOT Settlement Point Prices', () => {
  describe('calculateArbWindows', () => {
    it('finds charge (argmin) and discharge (argmax) windows', () => {
      // Realistic DAM prices for HB_HUBAVG - prices vary throughout day
      const damPrices: SppPrice[] = [
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T02:00:00.000Z', priceMwh: 22.50, hourEnding: 2, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T03:00:00.000Z', priceMwh: 18.75, hourEnding: 3, deliveryDate: '2024-09-15' }, // MIN
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T04:00:00.000Z', priceMwh: 21.00, hourEnding: 4, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T14:00:00.000Z', priceMwh: 45.25, hourEnding: 14, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T15:00:00.000Z', priceMwh: 52.80, hourEnding: 15, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T16:00:00.000Z', priceMwh: 68.50, hourEnding: 16, deliveryDate: '2024-09-15' }, // MAX
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T17:00:00.000Z', priceMwh: 61.20, hourEnding: 17, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T18:00:00.000Z', priceMwh: 48.90, hourEnding: 18, deliveryDate: '2024-09-15' },
      ];

      const result = calculateArbWindows(damPrices);

      expect(result.hasEdge).toBe(true);
      expect(result.chargeWindow).not.toBeNull();
      expect(result.dischargeWindow).not.toBeNull();
      expect(result.chargeWindow!.priceMwh).toBe(18.75);
      expect(result.chargeWindow!.hourEnding).toBe(3);
      expect(result.dischargeWindow!.priceMwh).toBe(68.50);
      expect(result.dischargeWindow!.hourEnding).toBe(16);
      expect(result.spreadMwh).toBeCloseTo(49.75, 2);
    });

    it('returns hasEdge: false when spread is below $5 threshold', () => {
      // Flat price curve - minimal spread
      const damPrices: SppPrice[] = [
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T02:00:00.000Z', priceMwh: 30.00, hourEnding: 2, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T03:00:00.000Z', priceMwh: 29.50, hourEnding: 3, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T04:00:00.000Z', priceMwh: 31.00, hourEnding: 4, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T05:00:00.000Z', priceMwh: 32.50, hourEnding: 5, deliveryDate: '2024-09-15' },
      ];

      const result = calculateArbWindows(damPrices);

      expect(result.hasEdge).toBe(false);
      expect(result.spreadMwh).toBeLessThan(ARB_EDGE_THRESHOLD_MWH);
      expect(result.explanation).toContain('No arb edge');
    });

    it('returns hasEdge: true when spread exactly equals $5 threshold', () => {
      const damPrices: SppPrice[] = [
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T02:00:00.000Z', priceMwh: 25.00, hourEnding: 2, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T03:00:00.000Z', priceMwh: 30.00, hourEnding: 3, deliveryDate: '2024-09-15' },
      ];

      const result = calculateArbWindows(damPrices);

      expect(result.hasEdge).toBe(true);
      expect(result.spreadMwh).toBe(5.0);
    });

    it('handles empty price array', () => {
      const result = calculateArbWindows([]);

      expect(result.hasEdge).toBe(false);
      expect(result.chargeWindow).toBeNull();
      expect(result.dischargeWindow).toBeNull();
      expect(result.explanation).toContain('No DAM price data');
    });

    it('respects DAM_HORIZON_HOURS limit (24 hours)', () => {
      // Generate 48 hours of data - should only use first 24 after sorting
      const damPrices: SppPrice[] = [];
      
      // First 24 hours (2024-09-15) - will be sorted first
      for (let i = 0; i < 24; i++) {
        damPrices.push({
          settlementPoint: 'HB_HUBAVG',
          timestamp: `2024-09-15T${String(i).padStart(2, '0')}:00:00.000Z`,
          priceMwh: i === 0 ? 10.00 : 35.00, // Min at hour 0
          hourEnding: i === 0 ? 24 : i,
          deliveryDate: '2024-09-15',
        });
      }
      
      // Next 24 hours (2024-09-16) - will be sorted after, outside horizon
      for (let i = 0; i < 24; i++) {
        damPrices.push({
          settlementPoint: 'HB_HUBAVG',
          timestamp: `2024-09-16T${String(i).padStart(2, '0')}:00:00.000Z`,
          priceMwh: i === 6 ? 100.00 : 35.00, // Max at hour 6 of day 2 (outside 24h horizon)
          hourEnding: i === 0 ? 24 : i,
          deliveryDate: '2024-09-16',
        });
      }

      const result = calculateArbWindows(damPrices);

      // Should find min at hour 0 ($10), max within first 24 hours only ($35)
      expect(result.chargeWindow!.priceMwh).toBe(10.00);
      // The max outside horizon ($100 at 2024-09-16T06:00) should not be selected
      expect(result.dischargeWindow!.priceMwh).toBe(35.00);
      expect(DAM_HORIZON_HOURS).toBe(24);
    });

    it('includes spread in explanation', () => {
      const damPrices: SppPrice[] = [
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T02:00:00.000Z', priceMwh: 20.00, hourEnding: 2, deliveryDate: '2024-09-15' },
        { settlementPoint: 'HB_HUBAVG', timestamp: '2024-09-15T16:00:00.000Z', priceMwh: 50.00, hourEnding: 16, deliveryDate: '2024-09-15' },
      ];

      const result = calculateArbWindows(damPrices);

      expect(result.explanation).toContain('$30.00/MWh spread');
      expect(result.explanation).toContain('charge @$20.00');
      expect(result.explanation).toContain('discharge @$50.00');
    });
  });

  describe('createUnavailablePriceCache', () => {
    it('creates unavailable cache with null price and no arb edge', () => {
      const result = createUnavailablePriceCache();

      expect(result.dataSource).toBe('cached');
      expect(result.currentPriceMwh).toBeNull();
      expect(result.rtPrices).toHaveLength(0);
      expect(result.damPrices).toHaveLength(0);
      expect(result.arbEdge.hasEdge).toBe(false);
      expect(result.snapshotId).toBe('UNAVAILABLE');
    });

    it('uses default settlement point HB_HUBAVG', () => {
      const result = createUnavailablePriceCache();
      expect(result.settlementPoint).toBe(DEFAULT_SETTLEMENT_POINT);
      expect(DEFAULT_SETTLEMENT_POINT).toBe('HB_HUBAVG');
    });

    it('accepts custom settlement point', () => {
      const result = createUnavailablePriceCache('LZ_HOUSTON');
      expect(result.settlementPoint).toBe('LZ_HOUSTON');
    });

    it('explanation indicates credentials not configured', () => {
      const result = createUnavailablePriceCache();
      expect(result.arbEdge.explanation).toContain('ERCOT credentials not configured');
    });
  });

  describe('Constants', () => {
    it('ARB_EDGE_THRESHOLD_MWH is $5 per PRD', () => {
      expect(ARB_EDGE_THRESHOLD_MWH).toBe(5);
    });

    it('DEFAULT_SETTLEMENT_POINT is HB_HUBAVG', () => {
      expect(DEFAULT_SETTLEMENT_POINT).toBe('HB_HUBAVG');
    });

    it('DAM_HORIZON_HOURS is 24', () => {
      expect(DAM_HORIZON_HOURS).toBe(24);
    });
  });

  describe('Price Honesty', () => {
    it('unavailable cache has dataSource: cached, not live', () => {
      const result = createUnavailablePriceCache();
      expect(result.dataSource).toBe('cached');
      expect(result.dataSource).not.toBe('live');
    });

    it('unavailable cache never invents SPP numbers', () => {
      const result = createUnavailablePriceCache();
      
      // Current price is null, not invented
      expect(result.currentPriceMwh).toBeNull();
      
      // No RT or DAM prices invented
      expect(result.rtPrices).toHaveLength(0);
      expect(result.damPrices).toHaveLength(0);
      
      // No arb windows invented
      expect(result.arbEdge.chargeWindow).toBeNull();
      expect(result.arbEdge.dischargeWindow).toBeNull();
    });
  });
});
