/**
 * ERCOT Weather Zone fixtures (synthetic data)
 * 
 * This is SYNTHETIC data for demonstration purposes only.
 * Not actual ERCOT operational data.
 */

export interface ErcotZone {
  id: string;
  name: string;
  /** Synthetic net load in MW */
  netLoadMw: number;
  /** Synthetic temperature in °F */
  temperatureF: number;
  /** Synthetic wind generation in MW */
  windMw: number;
  /** Synthetic solar generation in MW */
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

export const ERCOT_ZONES: (ErcotZone & { bounds: ZoneBounds })[] = [
  {
    id: 'COAST',
    name: 'Coast',
    netLoadMw: 8500,
    temperatureF: 82,
    windMw: 1200,
    solarMw: 450,
    centroid: [29.8, -96.0],
    bounds: { minLat: 29.2, maxLat: 30.5, minLng: -97.0, maxLng: -95.0 },
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
  },
];

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
