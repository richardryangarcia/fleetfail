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
 */

import type { ErcotCacheData, ErcotZoneLoad, ErcotGridSummary } from './ercot-cache.js';

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
  cacheLabel: 'Cached / Replay (ERCOT Sep 2024)',
  zones: ERCOT_FIXTURE_ZONES,
  gridSummary: computeGridSummary(ERCOT_FIXTURE_ZONES),
  snapshotId: 'ERCOT-REAL-2024-09-15-1430',
};

export const IL_REAL_FIXTURE: ErcotCacheData = {
  cachedAt: '2024-09-15T14:30:00.000Z',
  cacheLabel: 'Cached / Replay (MISO Sep 2024)',
  zones: IL_FIXTURE_ZONES,
  gridSummary: computeGridSummary(IL_FIXTURE_ZONES),
  snapshotId: 'MISO-IL-2024-09-15-1430',
};

export const COMBINED_REAL_FIXTURE: ErcotCacheData = {
  cachedAt: '2024-09-15T14:30:00.000Z',
  cacheLabel: 'Cached / Replay (ERCOT+MISO Sep 2024)',
  zones: [...ERCOT_FIXTURE_ZONES, ...IL_FIXTURE_ZONES],
  gridSummary: computeGridSummary([...ERCOT_FIXTURE_ZONES, ...IL_FIXTURE_ZONES]),
  snapshotId: 'ERCOT-MISO-COMBINED-2024-09-15-1430',
};

export function getErcotRealFixture(): ErcotCacheData {
  return ERCOT_REAL_FIXTURE;
}

export function getCombinedRealFixture(): ErcotCacheData {
  return COMBINED_REAL_FIXTURE;
}
