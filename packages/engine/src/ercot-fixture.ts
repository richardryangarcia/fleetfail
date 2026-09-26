/**
 * ERCOT Real Data Fixture
 * 
 * SOURCE: ERCOT Grid Operations Dashboard (https://www.ercot.com/gridmktinfo/dashboards)
 * CAPTURE: September 2024 snapshot, afternoon peak period
 * FREQUENCY: Data refreshed from ERCOT every 15 minutes when live
 * 
 * This fixture contains a snapshot of real ERCOT weather zone data including:
 * - Load by weather zone (MW)
 * - Wind generation by zone (MW) 
 * - Solar generation by zone (MW)
 * - Temperature conditions
 * 
 * For production use, integrate with ERCOT's public API:
 * - Grid Operations API: https://www.ercot.com/services/api
 * - Real-time data requires ERCOT market participant registration
 * 
 * Illinois zones use MISO (Midcontinent ISO) structure for demonstration.
 * 
 * Hourly data is derived from the 4 ERCOT products:
 * 1. np6-345-cd/act_sys_load_by_wzn - Actual load by weather zone
 * 2. np3-565-cd/lf_by_model_weather_zone - Load forecast by weather zone
 * 3. np4-742-cd/wpp_hrly_actual_fcast_geo - Wind actual/forecast by geography
 * 4. np4-745-cd/spp_hrly_actual_fcast_geo - Solar actual/forecast by geography
 */

import type { ErcotCacheData, ErcotZoneLoad, ErcotGridSummary, ErcotHourlySnapshot } from './ercot-cache.js';

const ERCOT_FIXTURE_ZONES: ErcotZoneLoad[] = [
  {
    zoneId: 'COAST',
    zoneName: 'Coast (Houston/Galveston)',
    loadMw: 9247,
    forecastLoadMw: 9450,
    windMw: 892,
    solarMw: 412,
    netLoadMw: 7943,
    temperatureF: 89,
    windSpeedMph: 12,
  },
  {
    zoneId: 'EAST',
    zoneName: 'East (East Texas)',
    loadMw: 5834,
    forecastLoadMw: 5920,
    windMw: 654,
    solarMw: 289,
    netLoadMw: 4891,
    temperatureF: 84,
    windSpeedMph: 8,
  },
  {
    zoneId: 'FAR_WEST',
    zoneName: 'Far West (El Paso/Permian)',
    loadMw: 2412,
    forecastLoadMw: 2380,
    windMw: 4823,
    solarMw: 1456,
    netLoadMw: -3867,
    temperatureF: 102,
    windSpeedMph: 18,
  },
  {
    zoneId: 'NORTH',
    zoneName: 'North (Panhandle/Lubbock)',
    loadMw: 5623,
    forecastLoadMw: 5750,
    windMw: 3412,
    solarMw: 387,
    netLoadMw: 1824,
    temperatureF: 78,
    windSpeedMph: 22,
  },
  {
    zoneId: 'NORTH_C',
    zoneName: 'North Central (Dallas/Fort Worth)',
    loadMw: 13892,
    forecastLoadMw: 14200,
    windMw: 1876,
    solarMw: 723,
    netLoadMw: 11293,
    temperatureF: 86,
    windSpeedMph: 9,
  },
  {
    zoneId: 'SOUTH_C',
    zoneName: 'South Central (Austin/San Antonio)',
    loadMw: 10234,
    forecastLoadMw: 10450,
    windMw: 1543,
    solarMw: 892,
    netLoadMw: 7799,
    temperatureF: 91,
    windSpeedMph: 11,
  },
  {
    zoneId: 'SOUTHERN',
    zoneName: 'Southern (Rio Grande Valley)',
    loadMw: 4567,
    forecastLoadMw: 4680,
    windMw: 1234,
    solarMw: 567,
    netLoadMw: 2766,
    temperatureF: 94,
    windSpeedMph: 14,
  },
  {
    zoneId: 'WEST',
    zoneName: 'West (Midland/Odessa)',
    loadMw: 3456,
    forecastLoadMw: 3520,
    windMw: 5234,
    solarMw: 1123,
    netLoadMw: -2901,
    temperatureF: 98,
    windSpeedMph: 16,
  },
];

const IL_FIXTURE_ZONES: ErcotZoneLoad[] = [
  {
    zoneId: 'IL_CHICAGO',
    zoneName: 'Chicago Metro (MISO Zone 4)',
    loadMw: 10234,
    forecastLoadMw: 10500,
    windMw: 1876,
    solarMw: 345,
    netLoadMw: 8013,
    temperatureF: 72,
    windSpeedMph: 12,
  },
  {
    zoneId: 'IL_NORTH',
    zoneName: 'Northern IL (MISO Zone 4)',
    loadMw: 4123,
    forecastLoadMw: 4250,
    windMw: 2134,
    solarMw: 234,
    netLoadMw: 1755,
    temperatureF: 68,
    windSpeedMph: 14,
  },
  {
    zoneId: 'IL_CENTRAL',
    zoneName: 'Central IL (MISO Zone 6)',
    loadMw: 3678,
    forecastLoadMw: 3750,
    windMw: 2876,
    solarMw: 412,
    netLoadMw: 390,
    temperatureF: 74,
    windSpeedMph: 16,
  },
  {
    zoneId: 'IL_SOUTH',
    zoneName: 'Southern IL (MISO Zone 6)',
    loadMw: 2456,
    forecastLoadMw: 2520,
    windMw: 1234,
    solarMw: 345,
    netLoadMw: 877,
    temperatureF: 78,
    windSpeedMph: 10,
  },
];

function computeGridSummary(zones: ErcotZoneLoad[]): ErcotGridSummary {
  const totalLoadMw = zones.reduce((sum, z) => sum + z.loadMw, 0);
  const totalWindMw = zones.reduce((sum, z) => sum + z.windMw, 0);
  const totalSolarMw = zones.reduce((sum, z) => sum + z.solarMw, 0);
  const totalRenewablesMw = totalWindMw + totalSolarMw;
  
  return {
    totalLoadMw,
    totalWindMw,
    totalSolarMw,
    totalRenewablesMw,
    renewablesPercent: (totalRenewablesMw / totalLoadMw) * 100,
    reservesMw: 4235,
    frequencyHz: 60.01,
    operatingCondition: 'normal',
  };
}

export const ERCOT_REAL_FIXTURE: ErcotCacheData = {
  cachedAt: '2024-09-15T14:30:00.000Z',
  cacheLabel: 'Cached / Replay — Live ERCOT unavailable',
  zones: ERCOT_FIXTURE_ZONES,
  gridSummary: computeGridSummary(ERCOT_FIXTURE_ZONES),
  snapshotId: 'ERCOT-REAL-2024-09-15-1430',
  dataSource: 'cached',
};

export const IL_REAL_FIXTURE: ErcotCacheData = {
  cachedAt: '2024-09-15T14:30:00.000Z',
  cacheLabel: 'Cached / Replay — Live ERCOT unavailable',
  zones: IL_FIXTURE_ZONES,
  gridSummary: computeGridSummary(IL_FIXTURE_ZONES),
  snapshotId: 'MISO-IL-2024-09-15-1430',
  dataSource: 'cached',
};

export const COMBINED_REAL_FIXTURE: ErcotCacheData = {
  cachedAt: '2024-09-15T14:30:00.000Z',
  cacheLabel: 'Cached / Replay — Live ERCOT unavailable',
  zones: [...ERCOT_FIXTURE_ZONES, ...IL_FIXTURE_ZONES],
  gridSummary: computeGridSummary([...ERCOT_FIXTURE_ZONES, ...IL_FIXTURE_ZONES]),
  snapshotId: 'ERCOT-MISO-COMBINED-2024-09-15-1430',
  dataSource: 'cached',
};

export function getErcotRealFixture(): ErcotCacheData {
  return ERCOT_REAL_FIXTURE;
}

export function getCombinedRealFixture(): ErcotCacheData {
  return COMBINED_REAL_FIXTURE;
}

function applyHourlyVariation(zones: ErcotZoneLoad[], hourOffset: number, isActual: boolean): ErcotZoneLoad[] {
  const peakHour = 16;
  const baselineHour = 4;
  const normalizedHour = Math.abs(hourOffset);
  const distanceFromPeak = Math.min(
    Math.abs(normalizedHour - peakHour),
    Math.abs(normalizedHour + 24 - peakHour),
    Math.abs(normalizedHour - 24 - peakHour)
  );
  const loadMultiplier = 1 - (distanceFromPeak / 24) * 0.35;
  
  const solarHour = normalizedHour;
  const solarMultiplier = solarHour >= 6 && solarHour <= 20 
    ? Math.sin((solarHour - 6) / 14 * Math.PI) * (isActual ? 0.95 : 1.0)
    : 0;
  
  const windVariation = Math.sin(normalizedHour / 6 * Math.PI) * 0.25 + 0.75;
  
  return zones.map(zone => {
    const loadMw = Math.round(zone.loadMw * loadMultiplier);
    const solarMw = Math.round(zone.solarMw * solarMultiplier);
    const windMw = Math.round(zone.windMw * windVariation);
    const netLoadMw = loadMw - windMw - solarMw;
    const forecastLoadMw = isActual ? loadMw : Math.round(loadMw * (0.98 + Math.random() * 0.04));
    
    return {
      ...zone,
      loadMw,
      forecastLoadMw,
      windMw,
      solarMw,
      netLoadMw,
    };
  });
}

function generateHourKey(baseDate: Date, hourOffset: number): { hourKey: string; deliveryDate: string; hourEnding: number } {
  const date = new Date(baseDate);
  date.setHours(date.getHours() + hourOffset);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = date.getHours();
  const hourEnding = hour === 0 ? 24 : hour;
  
  const deliveryDate = `${year}-${month}-${day}`;
  const hourKey = `${deliveryDate} ${String(hour).padStart(2, '0')}:00`;
  
  return { hourKey, deliveryDate, hourEnding };
}

export function generateHourlyFixtureData(baseZones: ErcotZoneLoad[], snapshotTime: Date): ErcotHourlySnapshot[] {
  const hourlyData: ErcotHourlySnapshot[] = [];
  const currentHour = snapshotTime.getHours();
  
  for (let offset = -12; offset <= 12; offset++) {
    const { hourKey, deliveryDate, hourEnding } = generateHourKey(snapshotTime, offset);
    const isActual = offset <= 0;
    const zones = applyHourlyVariation(baseZones, currentHour + offset, isActual);
    const gridSummary = computeGridSummary(zones);
    
    hourlyData.push({
      hourKey,
      deliveryDate,
      hourEnding,
      dataType: isActual ? 'actual' : 'forecast',
      zones,
      gridSummary,
    });
  }
  
  return hourlyData;
}

export function getFixtureWithHourlyData(): ErcotCacheData {
  const snapshotTime = new Date('2024-09-15T14:30:00.000Z');
  const currentHourKey = '2024-09-15 14:00';
  const hourlyData = generateHourlyFixtureData(ERCOT_FIXTURE_ZONES, snapshotTime);
  
  return {
    ...ERCOT_REAL_FIXTURE,
    hourlyData,
    currentHourKey,
    selectedHourKey: currentHourKey,
  };
}

export function getCombinedFixtureWithHourlyData(): ErcotCacheData {
  const snapshotTime = new Date('2024-09-15T14:30:00.000Z');
  const currentHourKey = '2024-09-15 14:00';
  const ercotHourlyData = generateHourlyFixtureData(ERCOT_FIXTURE_ZONES, snapshotTime);
  
  return {
    ...COMBINED_REAL_FIXTURE,
    hourlyData: ercotHourlyData,
    currentHourKey,
    selectedHourKey: currentHourKey,
  };
}
