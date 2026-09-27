import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FleetDb } from './db.js';
import type { ErcotCacheData, ErcotDataSource } from './ercot-cache.js';
import type { PriceCacheData } from './ercot-prices.js';

/**
 * Tests for FleetDb ERCOT last-good cache functionality.
 * 
 * Tests the SQLite persistence layer for rate-limit fallback:
 * - Save last-good grid data on live fetch success
 * - Load last-good grid data when live fetch fails (429/network)
 * - Same for price data with settlement point filtering
 * - Honesty: loaded data always has dataSource: 'cached'
 */

describe('FleetDb ERCOT Last-Good Cache', () => {
  let db: FleetDb;

  beforeEach(() => {
    db = new FleetDb({ path: ':memory:', inMemory: true });
  });

  afterEach(() => {
    db.close();
  });

  describe('Grid Data Cache', () => {
    const mockZone = {
      zoneId: 'COAST',
      zoneName: 'Coast (Houston/Galveston)',
      loadMw: 9247,
      forecastLoadMw: 9450,
      windMw: 892,
      solarMw: 412,
      netLoadMw: 7943,
      temperatureF: 89,
      windSpeedMph: 12,
    };
    
    const mockGridSummary = {
      totalLoadMw: 50000,
      totalWindMw: 10000,
      totalSolarMw: 5000,
      totalRenewablesMw: 15000,
      renewablesPercent: 30,
      reservesMw: 4000,
      frequencyHz: 60.0,
      operatingCondition: 'normal' as const,
    };
    
    const mockGridData: ErcotCacheData = {
      cachedAt: '2024-09-15T14:30:00.000Z',
      cacheLabel: 'LIVE',
      zones: [mockZone],
      gridSummary: mockGridSummary,
      snapshotId: 'ERCOT-LIVE-1234567890',
      dataSource: 'live' as ErcotDataSource,
      hourlyData: [
        {
          hourKey: '2024-09-15 14:00',
          deliveryDate: '2024-09-15',
          hourEnding: 14,
          dataType: 'actual' as const,
          zones: [mockZone],
          gridSummary: mockGridSummary,
        },
        {
          hourKey: '2024-09-15 15:00',
          deliveryDate: '2024-09-15',
          hourEnding: 15,
          dataType: 'forecast' as const,
          zones: [mockZone],
          gridSummary: mockGridSummary,
        },
      ],
      currentHourKey: '2024-09-15 14:00',
    };

    it('saves and loads grid data successfully', () => {
      db.saveLastGoodGrid(mockGridData);
      const loaded = db.loadLastGoodGrid();
      
      expect(loaded).not.toBeNull();
      expect(loaded!.zones).toHaveLength(1);
      expect(loaded!.zones[0].zoneId).toBe('COAST');
      expect(loaded!.gridSummary.totalLoadMw).toBe(50000);
    });

    it('returns null when no grid data exists', () => {
      const loaded = db.loadLastGoodGrid();
      expect(loaded).toBeNull();
    });

    it('hasLastGoodGrid returns true after save', () => {
      expect(db.hasLastGoodGrid()).toBe(false);
      db.saveLastGoodGrid(mockGridData);
      expect(db.hasLastGoodGrid()).toBe(true);
    });

    it('loaded grid data has dataSource: cached (honesty)', () => {
      db.saveLastGoodGrid(mockGridData);
      const loaded = db.loadLastGoodGrid();
      
      expect(loaded!.dataSource).toBe('cached');
      expect(loaded!.dataSource).not.toBe('live');
    });

    it('loaded grid data has fallback cacheLabel', () => {
      db.saveLastGoodGrid(mockGridData);
      const loaded = db.loadLastGoodGrid();
      
      expect(loaded!.cacheLabel).toBe('Cached / Replay — Live ERCOT unavailable');
    });

    it('overwrites previous grid data on save', () => {
      db.saveLastGoodGrid(mockGridData);
      
      const updatedData: ErcotCacheData = {
        ...mockGridData,
        gridSummary: { ...mockGridData.gridSummary, totalLoadMw: 60000 },
        hourlyData: mockGridData.hourlyData,
      };
      db.saveLastGoodGrid(updatedData);
      
      const loaded = db.loadLastGoodGrid();
      expect(loaded!.gridSummary.totalLoadMw).toBe(60000);
    });
    
    it('refuses to save empty hourlyData (v3 guard)', () => {
      const emptyHourlyData: ErcotCacheData = {
        ...mockGridData,
        hourlyData: [],
      };
      db.saveLastGoodGrid(emptyHourlyData);
      expect(db.hasLastGoodGrid()).toBe(false);
    });
    
    it('refuses to save undefined hourlyData (v3 guard)', () => {
      const noHourlyData: ErcotCacheData = {
        ...mockGridData,
        hourlyData: undefined,
      };
      db.saveLastGoodGrid(noHourlyData);
      expect(db.hasLastGoodGrid()).toBe(false);
    });
  });

  describe('Price Data Cache', () => {
    const mockPriceData: PriceCacheData = {
      cachedAt: '2024-09-15T14:30:00.000Z',
      dataSource: 'live' as ErcotDataSource,
      settlementPoint: 'HB_HUBAVG',
      currentPriceMwh: 45.50,
      rtPrices: [
        {
          settlementPoint: 'HB_HUBAVG',
          timestamp: '2024-09-15T14:15:00.000Z',
          priceMwh: 45.50,
          hourEnding: 15,
          deliveryDate: '2024-09-15',
        },
      ],
      damPrices: [
        {
          settlementPoint: 'HB_HUBAVG',
          timestamp: '2024-09-15T16:00:00.000Z',
          priceMwh: 52.00,
          hourEnding: 16,
          deliveryDate: '2024-09-15',
        },
      ],
      arbEdge: {
        hasEdge: true,
        spreadMwh: 10.00,
        chargeWindow: null,
        dischargeWindow: null,
        explanation: 'Test arb edge',
      },
      snapshotId: 'ERCOT-PRICES-LIVE-1234567890',
    };

    it('saves and loads price data successfully', () => {
      db.saveLastGoodPrices(mockPriceData);
      const loaded = db.loadLastGoodPrices('HB_HUBAVG');
      
      expect(loaded).not.toBeNull();
      expect(loaded!.currentPriceMwh).toBe(45.50);
      expect(loaded!.rtPrices).toHaveLength(1);
      expect(loaded!.damPrices).toHaveLength(1);
    });

    it('returns null when no price data exists', () => {
      const loaded = db.loadLastGoodPrices('HB_HUBAVG');
      expect(loaded).toBeNull();
    });

    it('returns null for wrong settlement point', () => {
      db.saveLastGoodPrices(mockPriceData);
      const loaded = db.loadLastGoodPrices('LZ_HOUSTON');
      expect(loaded).toBeNull();
    });

    it('hasLastGoodPrices returns true for matching settlement point', () => {
      expect(db.hasLastGoodPrices('HB_HUBAVG')).toBe(false);
      db.saveLastGoodPrices(mockPriceData);
      expect(db.hasLastGoodPrices('HB_HUBAVG')).toBe(true);
      expect(db.hasLastGoodPrices('LZ_HOUSTON')).toBe(false);
    });

    it('loaded price data has dataSource: cached (honesty)', () => {
      db.saveLastGoodPrices(mockPriceData);
      const loaded = db.loadLastGoodPrices('HB_HUBAVG');
      
      expect(loaded!.dataSource).toBe('cached');
      expect(loaded!.dataSource).not.toBe('live');
    });

    it('can store multiple settlement points', () => {
      db.saveLastGoodPrices(mockPriceData);
      
      const houstonData: PriceCacheData = {
        ...mockPriceData,
        settlementPoint: 'LZ_HOUSTON',
        currentPriceMwh: 48.00,
      };
      db.saveLastGoodPrices(houstonData);
      
      const hubAvg = db.loadLastGoodPrices('HB_HUBAVG');
      const houston = db.loadLastGoodPrices('LZ_HOUSTON');
      
      expect(hubAvg!.currentPriceMwh).toBe(45.50);
      expect(houston!.currentPriceMwh).toBe(48.00);
    });
  });

  describe('Clear', () => {
    it('clear removes ercot_last_good data', () => {
      const mockZone = {
        zoneId: 'COAST',
        zoneName: 'Coast',
        loadMw: 9000,
        forecastLoadMw: 9100,
        windMw: 800,
        solarMw: 400,
        netLoadMw: 7800,
        temperatureF: 88,
        windSpeedMph: 10,
      };
      const mockSummary = {
        totalLoadMw: 50000,
        totalWindMw: 10000,
        totalSolarMw: 5000,
        totalRenewablesMw: 15000,
        renewablesPercent: 30,
        reservesMw: 4000,
        frequencyHz: 60.0,
        operatingCondition: 'normal' as const,
      };
      const gridData: ErcotCacheData = {
        cachedAt: '2024-09-15T14:30:00.000Z',
        cacheLabel: 'LIVE',
        zones: [mockZone],
        gridSummary: mockSummary,
        snapshotId: 'TEST',
        dataSource: 'live' as ErcotDataSource,
        hourlyData: [{
          hourKey: '2024-09-15 14:00',
          deliveryDate: '2024-09-15',
          hourEnding: 14,
          dataType: 'actual' as const,
          zones: [mockZone],
          gridSummary: mockSummary,
        }],
        currentHourKey: '2024-09-15 14:00',
      };

      db.saveLastGoodGrid(gridData);
      expect(db.hasLastGoodGrid()).toBe(true);
      
      db.clear();
      expect(db.hasLastGoodGrid()).toBe(false);
    });
  });
});
