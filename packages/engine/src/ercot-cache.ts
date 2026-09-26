/**
 * ERCOT Real-Time Data Cache
 * 
 * This module provides cached/replay ERCOT weather-zone data.
 * The data structure mirrors real ERCOT API responses but values are
 * from a cached snapshot, not live data.
 * 
 * SOURCE: Real fixture data from ERCOT Grid Operations Dashboard
 * See ercot-fixture.ts for data provenance and documentation.
 */

import { SeededRandom } from './random.js';
import { COMBINED_REAL_FIXTURE } from './ercot-fixture.js';

export interface ErcotZoneLoad {
  zoneId: string;
  zoneName: string;
  /** Load in MW */
  loadMw: number;
  /** Forecast load for next hour in MW */
  forecastLoadMw: number;
  /** Wind generation in MW */
  windMw: number;
  /** Solar generation in MW */
  solarMw: number;
  /** Net load (load - wind - solar) in MW */
  netLoadMw: number;
  /** Temperature in the zone (°F) */
  temperatureF: number;
  /** Wind speed (mph) */
  windSpeedMph: number;
}

export interface ErcotGridSummary {
  /** Total system load in MW */
  totalLoadMw: number;
  /** Total wind generation in MW */
  totalWindMw: number;
  /** Total solar generation in MW */
  totalSolarMw: number;
  /** Total renewable generation in MW */
  totalRenewablesMw: number;
  /** Renewables as percent of load */
  renewablesPercent: number;
  /** Available reserves in MW */
  reservesMw: number;
  /** System frequency (Hz) */
  frequencyHz: number;
  /** Current operating condition */
  operatingCondition: 'normal' | 'watch' | 'emergency';
}

export interface ErcotHourlySnapshot {
  /** Hour key in format "YYYY-MM-DD HH:00" */
  hourKey: string;
  /** Delivery date (YYYY-MM-DD) */
  deliveryDate: string;
  /** Hour ending (1-24, ERCOT convention) */
  hourEnding: number;
  /** Whether this is actual (historical) or forecast data */
  dataType: 'actual' | 'forecast';
  /** Zone-level load data for this hour */
  zones: ErcotZoneLoad[];
  /** Grid-wide summary for this hour */
  gridSummary: ErcotGridSummary;
}

/** Data source indicator for ERCOT honesty */
export type ErcotDataSource = 'live' | 'cached';

export interface ErcotCacheData {
  /** When data was cached (ISO timestamp) */
  cachedAt: string;
  /** Cache label for display */
  cacheLabel: string;
  /** Zone-level load data (current/selected hour) */
  zones: ErcotZoneLoad[];
  /** Grid-wide summary (current/selected hour) */
  gridSummary: ErcotGridSummary;
  /** Snapshot ID for determinism */
  snapshotId: string;
  /** Hourly data from 4 ERCOT products (actuals + forecasts) */
  hourlyData?: ErcotHourlySnapshot[];
  /** Currently selected hour key */
  selectedHourKey?: string;
  /** Current hour key (for "now" marker) */
  currentHourKey?: string;
  /** Data source: 'live' when credentials present AND fetch succeeded, 'cached' otherwise */
  dataSource: ErcotDataSource;
}

const ZONE_BASE_DATA: Record<string, { name: string; baseLoadMw: number; windCapacity: number; solarCapacity: number; avgTempF: number }> = {
  COAST: { name: 'Coast', baseLoadMw: 8500, windCapacity: 2000, solarCapacity: 800, avgTempF: 82 },
  EAST: { name: 'East', baseLoadMw: 6200, windCapacity: 1200, solarCapacity: 600, avgTempF: 78 },
  FAR_WEST: { name: 'Far West', baseLoadMw: 2100, windCapacity: 8000, solarCapacity: 2000, avgTempF: 95 },
  NORTH: { name: 'North', baseLoadMw: 5800, windCapacity: 4000, solarCapacity: 500, avgTempF: 76 },
  NORTH_C: { name: 'North Central', baseLoadMw: 12500, windCapacity: 3000, solarCapacity: 1000, avgTempF: 79 },
  SOUTH_C: { name: 'South Central', baseLoadMw: 9200, windCapacity: 2500, solarCapacity: 1200, avgTempF: 84 },
  SOUTHERN: { name: 'Southern', baseLoadMw: 4800, windCapacity: 1500, solarCapacity: 900, avgTempF: 86 },
  WEST: { name: 'West', baseLoadMw: 3200, windCapacity: 6000, solarCapacity: 1500, avgTempF: 91 },
};

/**
 * Generate a cached ERCOT data snapshot.
 * Uses a seed for deterministic replay.
 */
export function generateErcotCacheSnapshot(seed: number): ErcotCacheData {
  const rng = new SeededRandom(seed);
  
  const snapshotDate = new Date(2026, 8, 26, 14, 30, 0);
  const snapshotId = `ERCOT-${seed.toString(16).padStart(8, '0')}`;
  
  const zones: ErcotZoneLoad[] = Object.entries(ZONE_BASE_DATA).map(([zoneId, base]) => {
    const loadVariation = rng.float(0.85, 1.15);
    const loadMw = Math.round(base.baseLoadMw * loadVariation);
    
    const windCapacityFactor = rng.float(0.15, 0.65);
    const windMw = Math.round(base.windCapacity * windCapacityFactor);
    
    const solarCapacityFactor = rng.float(0.3, 0.85);
    const solarMw = Math.round(base.solarCapacity * solarCapacityFactor);
    
    const netLoadMw = loadMw - windMw - solarMw;
    
    const forecastLoadMw = Math.round(loadMw * rng.float(0.98, 1.05));
    const temperatureF = Math.round(base.avgTempF + rng.float(-8, 12));
    const windSpeedMph = Math.round(5 + rng.float(0, 20));
    
    return {
      zoneId,
      zoneName: base.name,
      loadMw,
      forecastLoadMw,
      windMw,
      solarMw,
      netLoadMw,
      temperatureF,
      windSpeedMph,
    };
  });
  
  const totalLoadMw = zones.reduce((sum, z) => sum + z.loadMw, 0);
  const totalWindMw = zones.reduce((sum, z) => sum + z.windMw, 0);
  const totalSolarMw = zones.reduce((sum, z) => sum + z.solarMw, 0);
  const totalRenewablesMw = totalWindMw + totalSolarMw;
  
  const gridSummary: ErcotGridSummary = {
    totalLoadMw,
    totalWindMw,
    totalSolarMw,
    totalRenewablesMw,
    renewablesPercent: (totalRenewablesMw / totalLoadMw) * 100,
    reservesMw: Math.round(3000 + rng.float(0, 2000)),
    frequencyHz: 60.0 + rng.float(-0.02, 0.02),
    operatingCondition: 'normal',
  };
  
  return {
    cachedAt: snapshotDate.toISOString(),
    cacheLabel: 'Cached / Replay — Live ERCOT unavailable',
    zones,
    gridSummary,
    snapshotId,
    dataSource: 'cached',
  };
}

/**
 * Get zone stress ranking based on net load.
 * Higher net load = more stressed = higher priority for DR.
 * Zones with negative net load (more renewables than load) get low scores.
 */
export function getZoneStressRanking(cacheData: ErcotCacheData): Array<{ zoneId: string; stressScore: number }> {
  const netLoads = cacheData.zones.map(z => z.netLoadMw);
  const maxNetLoad = Math.max(...netLoads);
  const minNetLoad = Math.min(...netLoads);
  
  const range = maxNetLoad - minNetLoad;
  if (range === 0) {
    return cacheData.zones.map(z => ({ zoneId: z.zoneId, stressScore: 0.5 }));
  }
  
  return cacheData.zones
    .map(z => ({
      zoneId: z.zoneId,
      stressScore: (z.netLoadMw - minNetLoad) / range,
    }))
    .sort((a, b) => b.stressScore - a.stressScore);
}

/**
 * Create zone preferences based on cached ERCOT stress data.
 * Zones with higher net load get higher allocation priority.
 */
export function createCachedLoadPreferences(cacheData: ErcotCacheData): Array<{ zoneId: string; weight: number }> {
  const stressRanking = getZoneStressRanking(cacheData);
  return stressRanking.map(({ zoneId, stressScore }) => ({
    zoneId,
    weight: stressScore,
  }));
}

let cachedSnapshot: ErcotCacheData | null = null;

/**
 * Get or create the ERCOT cache singleton.
 * Returns real fixture data by default. Pass useSynthetic=true for generated data.
 */
export function getErcotCache(seed: number = 20260926, useSynthetic: boolean = false): ErcotCacheData {
  if (!cachedSnapshot) {
    cachedSnapshot = useSynthetic 
      ? generateErcotCacheSnapshot(seed)
      : COMBINED_REAL_FIXTURE;
  }
  return cachedSnapshot;
}

/**
 * Reset the cache (for testing or seed changes).
 */
export function resetErcotCache(): void {
  cachedSnapshot = null;
}
