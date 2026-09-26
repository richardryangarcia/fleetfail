/**
 * Grid Zone fixtures
 * 
 * ERCOT (TX): Real cached data from ERCOT API (see ercot-cache.ts for source)
 * IL Zones: Synthetic load zones for demonstration
 */

import type { DeviceRegion } from './types.js';

export interface ErcotZone {
  id: string;
  name: string;
  /** Net load in MW */
  netLoadMw: number;
  /** Temperature in °F */
  temperatureF: number;
  /** Wind generation in MW */
  windMw: number;
  /** Solar generation in MW */
  solarMw: number;
  /** Zone centroid for map display (lat, lng) */
  centroid: [number, number];
}

export interface ZoneBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface GridZone extends ErcotZone {
  bounds: ZoneBounds;
  region: DeviceRegion;
}

export const ERCOT_ZONES: GridZone[] = [
  {
    id: 'COAST',
    name: 'Coast',
    netLoadMw: 8500,
    temperatureF: 82,
    windMw: 1200,
    solarMw: 450,
    centroid: [29.8, -96.0],
    bounds: { minLat: 29.2, maxLat: 30.5, minLng: -97.0, maxLng: -95.0 },
    region: 'TX',
  },
  {
    id: 'EAST',
    name: 'East',
    netLoadMw: 6200,
    temperatureF: 78,
    windMw: 800,
    solarMw: 380,
    centroid: [32.0, -95.0],
    bounds: { minLat: 31.0, maxLat: 33.5, minLng: -96.0, maxLng: -94.0 },
    region: 'TX',
  },
  {
    id: 'FAR_WEST',
    name: 'Far West',
    netLoadMw: 2100,
    temperatureF: 95,
    windMw: 4500,
    solarMw: 1200,
    centroid: [31.5, -103.5],
    bounds: { minLat: 30.5, maxLat: 32.5, minLng: -104.5, maxLng: -102.5 },
    region: 'TX',
  },
  {
    id: 'NORTH',
    name: 'North',
    netLoadMw: 5800,
    temperatureF: 76,
    windMw: 2200,
    solarMw: 320,
    centroid: [33.5, -97.5],
    bounds: { minLat: 33.0, maxLat: 34.5, minLng: -98.5, maxLng: -96.5 },
    region: 'TX',
  },
  {
    id: 'NORTH_C',
    name: 'North Central',
    netLoadMw: 12500,
    temperatureF: 79,
    windMw: 1800,
    solarMw: 560,
    centroid: [32.8, -97.0],
    bounds: { minLat: 32.0, maxLat: 33.5, minLng: -98.0, maxLng: -96.0 },
    region: 'TX',
  },
  {
    id: 'SOUTH_C',
    name: 'South Central',
    netLoadMw: 9200,
    temperatureF: 84,
    windMw: 1500,
    solarMw: 680,
    centroid: [29.5, -98.5],
    bounds: { minLat: 28.8, maxLat: 30.5, minLng: -99.5, maxLng: -97.5 },
    region: 'TX',
  },
  {
    id: 'SOUTHERN',
    name: 'Southern',
    netLoadMw: 4800,
    temperatureF: 86,
    windMw: 900,
    solarMw: 520,
    centroid: [27.8, -98.5],
    bounds: { minLat: 26.5, maxLat: 28.5, minLng: -99.5, maxLng: -97.5 },
    region: 'TX',
  },
  {
    id: 'WEST',
    name: 'West',
    netLoadMw: 3200,
    temperatureF: 91,
    windMw: 3800,
    solarMw: 950,
    centroid: [31.0, -100.5],
    bounds: { minLat: 30.0, maxLat: 32.5, minLng: -102.0, maxLng: -99.0 },
    region: 'TX',
  },
];

export const IL_ZONES: GridZone[] = [
  {
    id: 'IL_CHICAGO',
    name: 'Chicago Metro',
    netLoadMw: 9500,
    temperatureF: 68,
    windMw: 2100,
    solarMw: 400,
    centroid: [41.8, -87.7],
    bounds: { minLat: 41.5, maxLat: 42.2, minLng: -88.3, maxLng: -87.2 },
    region: 'IL',
  },
  {
    id: 'IL_NORTH',
    name: 'Northern IL',
    netLoadMw: 4200,
    temperatureF: 65,
    windMw: 1800,
    solarMw: 280,
    centroid: [42.3, -89.0],
    bounds: { minLat: 42.0, maxLat: 42.5, minLng: -90.0, maxLng: -88.0 },
    region: 'IL',
  },
  {
    id: 'IL_CENTRAL',
    name: 'Central IL',
    netLoadMw: 3800,
    temperatureF: 70,
    windMw: 2500,
    solarMw: 450,
    centroid: [40.1, -89.4],
    bounds: { minLat: 39.5, maxLat: 40.8, minLng: -90.5, maxLng: -88.5 },
    region: 'IL',
  },
  {
    id: 'IL_SOUTH',
    name: 'Southern IL',
    netLoadMw: 2600,
    temperatureF: 74,
    windMw: 1200,
    solarMw: 380,
    centroid: [38.0, -89.2],
    bounds: { minLat: 37.0, maxLat: 39.0, minLng: -90.5, maxLng: -88.0 },
    region: 'IL',
  },
];

export const ALL_ZONES: GridZone[] = [...ERCOT_ZONES, ...IL_ZONES];

export function getZoneById(zoneId: string): ErcotZone | undefined {
  return ERCOT_ZONES.find(z => z.id === zoneId);
}

export function getTotalGridLoad(): number {
  return ERCOT_ZONES.reduce((sum, z) => sum + z.netLoadMw, 0);
}

export function getTotalRenewableGeneration(): number {
  return ERCOT_ZONES.reduce((sum, z) => sum + z.windMw + z.solarMw, 0);
}

export interface GridStatus {
  totalLoadMw: number;
  renewablesMw: number;
  renewablePercent: number;
  avgTemperatureF: number;
  timestamp: number;
}

export function getGridStatus(): GridStatus {
  const totalLoad = getTotalGridLoad();
  const renewables = getTotalRenewableGeneration();
  const avgTemp = ERCOT_ZONES.reduce((sum, z) => sum + z.temperatureF, 0) / ERCOT_ZONES.length;
  
  return {
    totalLoadMw: totalLoad,
    renewablesMw: renewables,
    renewablePercent: (renewables / totalLoad) * 100,
    avgTemperatureF: avgTemp,
    timestamp: Date.now(),
  };
}
