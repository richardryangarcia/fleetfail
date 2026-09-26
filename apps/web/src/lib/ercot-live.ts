/**
 * ERCOT Live Public API Client
 * 
 * Server-side only - DO NOT import in client components.
 * 
 * Authenticates via OAuth2 ROPC (Resource Owner Password Credentials) flow
 * and fetches real-time data from ERCOT's public API.
 * 
 * Environment variables (never expose to client):
 * - ERCOT_API_USERNAME
 * - ERCOT_API_PASSWORD
 * - ERCOT_PUBLIC_API_SUBSCRIPTION_KEY
 */

import axios from 'axios';
import type { AxiosInstance, AxiosError } from 'axios';
import type { ErcotCacheData, ErcotZoneLoad, ErcotGridSummary } from '@fleetfail/engine';

const ERCOT_TOKEN_URL = 'https://ercotb2c.b2clogin.com/ercotb2c.onmicrosoft.com/B2C_1_PUBAPI-ROPC-FLOW/oauth2/v2.0/token';
const ERCOT_API_BASE = 'https://api.ercot.com/api/public-reports';
const ERCOT_CLIENT_ID = 'fec253ea-0d06-4272-a5e6-b478baeecd70';
const ERCOT_SCOPE = 'openid fec253ea-0d06-4272-a5e6-b478baeecd70 offline_access';

interface TokenResponse {
  id_token: string;
  access_token?: string;
  token_type: string;
  expires_in: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  
  if (tokenCache && tokenCache.expiresAt > now + 60000) {
    return tokenCache.token;
  }
  
  const username = process.env.ERCOT_API_USERNAME;
  const password = process.env.ERCOT_API_PASSWORD;
  
  if (!username || !password) {
    throw new Error('ERCOT credentials not configured');
  }
  
  const params = new URLSearchParams({
    grant_type: 'password',
    client_id: ERCOT_CLIENT_ID,
    scope: ERCOT_SCOPE,
    username,
    password,
    response_type: 'id_token',
  });
  
  const response = await axios.post<TokenResponse>(ERCOT_TOKEN_URL, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: 10000,
  });
  
  const { id_token, expires_in } = response.data;
  
  tokenCache = {
    token: id_token,
    expiresAt: now + (expires_in * 1000),
  };
  
  return id_token;
}

function createApiClient(token: string): AxiosInstance {
  const subscriptionKey = process.env.ERCOT_PUBLIC_API_SUBSCRIPTION_KEY;
  
  if (!subscriptionKey) {
    throw new Error('ERCOT subscription key not configured');
  }
  
  return axios.create({
    baseURL: ERCOT_API_BASE,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
    timeout: 15000,
  });
}

interface ErcotApiResponse<T> {
  data: T[];
  meta?: {
    totalRecords?: number;
  };
}

interface ActualLoadByZone {
  deliveryDate: string;
  hourEnding: string;
  coast: number;
  east: number;
  farWest: number;
  north: number;
  northCentral: number;
  southCentral: number;
  southern: number;
  west: number;
  systemTotal: number;
}

interface LoadForecastByZone {
  deliveryDate: string;
  hourEnding: string;
  model: string;
  coast: number;
  east: number;
  farWest: number;
  north: number;
  northCentral: number;
  southCentral: number;
  southern: number;
  west: number;
  systemTotal: number;
}

interface WindActualForecast {
  deliveryDate: string;
  hourEnding: string;
  actual?: number;
  stppf?: number;
  wgrpp?: number;
  copHsl?: number;
  hsl?: number;
  geoRegion?: string;
}

interface SolarActualForecast {
  deliveryDate: string;
  hourEnding: string;
  actual?: number;
  stppf?: number;
  copHsl?: number;
  hsl?: number;
  geoRegion?: string;
}

export async function fetchActualLoadByWeatherZone(): Promise<ActualLoadByZone[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<ActualLoadByZone>>('/np6-345-cd/act_sys_load_by_wzn', {
    params: {
      size: 24,
      sort: 'deliveryDate desc,hourEnding desc',
    },
  });
  
  return response.data.data || [];
}

export async function fetchLoadForecastByWeatherZone(): Promise<LoadForecastByZone[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<LoadForecastByZone>>('/np3-565-cd/lf_by_model_weather_zone', {
    params: {
      size: 24,
      sort: 'deliveryDate desc,hourEnding desc',
    },
  });
  
  return response.data.data || [];
}

export async function fetchWindActualAndForecast(): Promise<WindActualForecast[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<WindActualForecast>>('/np4-742-cd/wpp_hrly_actual_fcast_geo', {
    params: {
      size: 100,
      sort: 'deliveryDate desc,hourEnding desc',
    },
  });
  
  return response.data.data || [];
}

export async function fetchSolarActualAndForecast(): Promise<SolarActualForecast[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const paths = [
    '/np4-745-cd/spp_hrly_actual_fcast_geo',
    '/np4-745-cd/spp_hrly_actual_fcast_ge',
  ];
  
  for (const path of paths) {
    try {
      const response = await client.get<ErcotApiResponse<SolarActualForecast>>(path, {
        params: {
          size: 100,
          sort: 'deliveryDate desc,hourEnding desc',
        },
      });
      
      if (response.data.data && response.data.data.length > 0) {
        return response.data.data;
      }
    } catch (err: unknown) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 404) {
        continue;
      }
      throw err;
    }
  }
  
  return [];
}

const ZONE_MAPPING: Record<string, { id: string; name: string }> = {
  coast: { id: 'COAST', name: 'Coast (Houston/Galveston)' },
  east: { id: 'EAST', name: 'East (East Texas)' },
  farWest: { id: 'FAR_WEST', name: 'Far West (El Paso/Permian)' },
  north: { id: 'NORTH', name: 'North (Panhandle/Lubbock)' },
  northCentral: { id: 'NORTH_C', name: 'North Central (Dallas/Fort Worth)' },
  southCentral: { id: 'SOUTH_C', name: 'South Central (Austin/San Antonio)' },
  southern: { id: 'SOUTHERN', name: 'Southern (Rio Grande Valley)' },
  west: { id: 'WEST', name: 'West (Midland/Odessa)' },
};

const ZONE_KEY_TO_ID: Record<string, string> = {
  coast: 'COAST',
  east: 'EAST',
  farWest: 'FAR_WEST',
  north: 'NORTH',
  northCentral: 'NORTH_C',
  southCentral: 'SOUTH_C',
  southern: 'SOUTHERN',
  west: 'WEST',
};

const GEO_REGION_TO_ZONES: Record<string, string[]> = {
  'COAST': ['COAST'],
  'EAST': ['EAST'],
  'FAR_WEST': ['FAR_WEST'],
  'NORTH': ['NORTH'],
  'NORTH_CENTRAL': ['NORTH_C'],
  'SOUTH_CENTRAL': ['SOUTH_C'],
  'SOUTHERN': ['SOUTHERN'],
  'SOUTH': ['SOUTHERN'],
  'WEST': ['WEST'],
  'PANHANDLE': ['NORTH'],
  'SYSTEM': Object.values(ZONE_KEY_TO_ID),
};

function distributeRenewableToZones(
  renewable: number,
  geoRegion: string | undefined,
  zoneDistribution: Map<string, number>
): void {
  const regions = geoRegion?.toUpperCase() || 'SYSTEM';
  const targetZones = GEO_REGION_TO_ZONES[regions] || GEO_REGION_TO_ZONES['SYSTEM'];
  const perZone = renewable / targetZones.length;
  
  for (const zoneId of targetZones) {
    const current = zoneDistribution.get(zoneId) || 0;
    zoneDistribution.set(zoneId, current + perZone);
  }
}

export async function fetchLiveErcotData(): Promise<ErcotCacheData> {
  const [actualLoad, loadForecast, windData, solarData] = await Promise.all([
    fetchActualLoadByWeatherZone(),
    fetchLoadForecastByWeatherZone(),
    fetchWindActualAndForecast(),
    fetchSolarActualAndForecast(),
  ]);
  
  const latestLoad = actualLoad[0];
  const latestForecast = loadForecast[0];
  
  if (!latestLoad) {
    throw new Error('No load data available from ERCOT API');
  }
  
  const windByZone = new Map<string, number>();
  const solarByZone = new Map<string, number>();
  
  const latestWindByRegion = new Map<string, WindActualForecast>();
  for (const w of windData) {
    const region = w.geoRegion || 'SYSTEM';
    if (!latestWindByRegion.has(region)) {
      latestWindByRegion.set(region, w);
    }
  }
  
  for (const [, w] of latestWindByRegion) {
    const actual = w.actual ?? w.stppf ?? 0;
    distributeRenewableToZones(actual, w.geoRegion, windByZone);
  }
  
  const latestSolarByRegion = new Map<string, SolarActualForecast>();
  for (const s of solarData) {
    const region = s.geoRegion || 'SYSTEM';
    if (!latestSolarByRegion.has(region)) {
      latestSolarByRegion.set(region, s);
    }
  }
  
  for (const [, s] of latestSolarByRegion) {
    const actual = s.actual ?? s.stppf ?? 0;
    distributeRenewableToZones(actual, s.geoRegion, solarByZone);
  }
  
  function getLoadValue(load: ActualLoadByZone, key: string): number {
    switch (key) {
      case 'coast': return load.coast;
      case 'east': return load.east;
      case 'farWest': return load.farWest;
      case 'north': return load.north;
      case 'northCentral': return load.northCentral;
      case 'southCentral': return load.southCentral;
      case 'southern': return load.southern;
      case 'west': return load.west;
      default: return 0;
    }
  }
  
  function getForecastValue(forecast: LoadForecastByZone | undefined, key: string, fallback: number): number {
    if (!forecast) return fallback;
    switch (key) {
      case 'coast': return forecast.coast;
      case 'east': return forecast.east;
      case 'farWest': return forecast.farWest;
      case 'north': return forecast.north;
      case 'northCentral': return forecast.northCentral;
      case 'southCentral': return forecast.southCentral;
      case 'southern': return forecast.southern;
      case 'west': return forecast.west;
      default: return fallback;
    }
  }
  
  const zones: ErcotZoneLoad[] = Object.entries(ZONE_MAPPING).map(([key, zone]) => {
    const loadMw = Math.round(getLoadValue(latestLoad, key));
    const forecastLoadMw = Math.round(getForecastValue(latestForecast, key, loadMw));
    const windMw = Math.round(windByZone.get(zone.id) || 0);
    const solarMw = Math.round(solarByZone.get(zone.id) || 0);
    const netLoadMw = loadMw - windMw - solarMw;
    
    return {
      zoneId: zone.id,
      zoneName: zone.name,
      loadMw,
      forecastLoadMw,
      windMw,
      solarMw,
      netLoadMw,
      temperatureF: 85,
      windSpeedMph: 12,
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
    renewablesPercent: totalLoadMw > 0 ? (totalRenewablesMw / totalLoadMw) * 100 : 0,
    reservesMw: 4000,
    frequencyHz: 60.0,
    operatingCondition: 'normal',
  };
  
  const captureTime = new Date();
  
  return {
    cachedAt: captureTime.toISOString(),
    cacheLabel: `Cached / Replay (Live ERCOT ${captureTime.toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true,
    })})`,
    zones,
    gridSummary,
    snapshotId: `ERCOT-LIVE-${captureTime.getTime()}`,
  };
}

export function hasErcotCredentials(): boolean {
  return !!(
    process.env.ERCOT_API_USERNAME &&
    process.env.ERCOT_API_PASSWORD &&
    process.env.ERCOT_PUBLIC_API_SUBSCRIPTION_KEY
  );
}

export function clearTokenCache(): void {
  tokenCache = null;
}
