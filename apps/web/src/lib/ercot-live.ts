/**
 * ERCOT Live Public API Client
 * 
 * Server-side only - DO NOT import in client components.
 * 
 * Authenticates via OAuth2 ROPC (Resource Owner Password Credentials) flow
 * and fetches real-time data from ERCOT's public API.
 * 
 * Rate Limiting Strategy:
 * - Serialized outbound calls (no Promise.all burst)
 * - Respects Retry-After header on 429 responses
 * - Retries up to 2 times with exponential backoff
 * - Falls back to last-good SQLite snapshot on exhausted retries
 * 
 * Data Source Honesty:
 * - dataSource: 'live' ONLY when current request's live fetch succeeds
 * - dataSource: 'cached' for SQLite last-good or fixture fallback
 * 
 * Environment variables (never expose to client):
 * - ERCOT_API_USERNAME
 * - ERCOT_API_PASSWORD
 * - ERCOT_PUBLIC_API_SUBSCRIPTION_KEY
 */

import axios from 'axios';
import type { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import type { ErcotCacheData, ErcotZoneLoad, ErcotGridSummary, ErcotHourlySnapshot } from '@fleetfail/engine';
import { FleetDb, encodeErcotSort } from '@fleetfail/engine';

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

// ============================================================================
// RATE LIMITING & RETRY INFRASTRUCTURE
// ============================================================================

const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;
const STAGGER_DELAY_MS = 200;

let ercotDb: FleetDb | null = null;
let ercotDbInitFailed = false;
let ercotDbErrorLogged = false;

/**
 * Get the ERCOT SQLite cache database.
 * Returns null if better-sqlite3 bindings are unavailable (e.g., Next.js webpack).
 * Logs the error once on first failure, then silently returns null.
 */
function getErcotDb(): FleetDb | null {
  if (ercotDbInitFailed) {
    return null;
  }
  if (!ercotDb) {
    try {
      ercotDb = new FleetDb({ path: '.ercot-cache.db', inMemory: false });
    } catch (err) {
      ercotDbInitFailed = true;
      if (!ercotDbErrorLogged) {
        ercotDbErrorLogged = true;
        console.warn('SQLite cache unavailable (better-sqlite3 bindings missing), falling back to fixture:', err);
      }
      return null;
    }
  }
  return ercotDb;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryAfterMs(error: AxiosError): number {
  const retryAfter = error.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = parseInt(retryAfter, 10);
    if (!isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function isRateLimitError(error: unknown): error is AxiosError {
  if (!axios.isAxiosError(error)) return false;
  return error.response?.status === 429;
}

function isRetryableError(error: unknown): error is AxiosError {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 429 || status === 503 || status === 502 || !status;
}

interface RetryableRequest<T> {
  execute: () => Promise<T>;
  description: string;
}

async function executeWithRetry<T>(
  request: RetryableRequest<T>
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await request.execute();
    } catch (error) {
      lastError = error;
      
      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }
      
      const delayMs = isRateLimitError(error) 
        ? getRetryAfterMs(error) 
        : DEFAULT_RETRY_DELAY_MS * Math.pow(2, attempt);
      
      console.warn(
        `ERCOT API ${request.description} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}), ` +
        `retrying in ${delayMs}ms: ${error.message}`
      );
      
      await sleep(delayMs);
    }
  }
  
  throw lastError;
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
      sort: encodeErcotSort(['deliveryDate desc', 'hourEnding desc']),
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
      sort: encodeErcotSort(['deliveryDate desc', 'hourEnding desc']),
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
      sort: encodeErcotSort(['deliveryDate desc', 'hourEnding desc']),
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
          sort: encodeErcotSort(['deliveryDate desc', 'hourEnding desc']),
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

function getLoadValue(load: ActualLoadByZone | LoadForecastByZone, key: string): number {
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

function parseHourKey(deliveryDate: string, hourEnding: string): { hourKey: string; hourEndingNum: number } {
  const hourEndingNum = parseInt(hourEnding.replace(':00', '').trim(), 10);
  const displayHour = hourEndingNum === 24 ? 0 : hourEndingNum;
  const hourKey = `${deliveryDate} ${String(displayHour).padStart(2, '0')}:00`;
  return { hourKey, hourEndingNum };
}

function buildZonesFromLoadData(
  loadData: ActualLoadByZone | LoadForecastByZone,
  windByHourZone: Map<string, Map<string, number>>,
  solarByHourZone: Map<string, Map<string, number>>,
  hourKey: string,
  isActual: boolean
): ErcotZoneLoad[] {
  const windZones = windByHourZone.get(hourKey) || new Map<string, number>();
  const solarZones = solarByHourZone.get(hourKey) || new Map<string, number>();
  
  return Object.entries(ZONE_MAPPING).map(([key, zone]) => {
    const loadMw = Math.round(getLoadValue(loadData, key));
    const forecastLoadMw = isActual ? loadMw : Math.round(loadMw);
    const windMw = Math.round(windZones.get(zone.id) || 0);
    const solarMw = Math.round(solarZones.get(zone.id) || 0);
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
}

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
    renewablesPercent: totalLoadMw > 0 ? (totalRenewablesMw / totalLoadMw) * 100 : 0,
    reservesMw: 4000,
    frequencyHz: 60.0,
    operatingCondition: 'normal',
  };
}

/**
 * Fetch all ERCOT grid data with serialized calls and retry logic.
 * Saves successful results to SQLite for fallback.
 * Falls back to last-good SQLite snapshot on failure.
 */
export async function fetchLiveErcotData(): Promise<ErcotCacheData> {
  try {
    const actualLoad = await executeWithRetry({
      execute: () => fetchActualLoadByWeatherZone(),
      description: 'actual load by weather zone',
    });
    
    await sleep(STAGGER_DELAY_MS);
    
    const loadForecast = await executeWithRetry({
      execute: () => fetchLoadForecastByWeatherZone(),
      description: 'load forecast by weather zone',
    });
    
    await sleep(STAGGER_DELAY_MS);
    
    const windData = await executeWithRetry({
      execute: () => fetchWindActualAndForecast(),
      description: 'wind actual and forecast',
    });
    
    await sleep(STAGGER_DELAY_MS);
    
    const solarData = await executeWithRetry({
      execute: () => fetchSolarActualAndForecast(),
      description: 'solar actual and forecast',
    });
    
    if (!actualLoad.length && !loadForecast.length) {
      throw new Error('No load data available from ERCOT API');
    }
    
    const result = buildErcotCacheData(actualLoad, loadForecast, windData, solarData);
    
    const db = getErcotDb();
    if (db) {
      try {
        db.saveLastGoodGrid(result);
      } catch (dbError) {
        console.warn('Failed to save ERCOT data to SQLite cache:', dbError);
      }
    }
    
    return result;
  } catch (error) {
    console.error('ERCOT live fetch failed after retries:', error);
    
    const db = getErcotDb();
    if (db) {
      try {
        const cached = db.loadLastGoodGrid();
        if (cached) {
          console.log('Falling back to last-good ERCOT grid data from SQLite');
          return cached;
        }
      } catch (dbError) {
        console.warn('Failed to load ERCOT data from SQLite cache:', dbError);
      }
    }
    
    throw error;
  }
}

function buildErcotCacheData(
  actualLoad: ActualLoadByZone[],
  loadForecast: LoadForecastByZone[],
  windData: WindActualForecast[],
  solarData: SolarActualForecast[]
): ErcotCacheData {
  if (!actualLoad.length && !loadForecast.length) {
    throw new Error('No load data available from ERCOT API');
  }
  
  const windByHourZone = new Map<string, Map<string, number>>();
  const solarByHourZone = new Map<string, Map<string, number>>();
  
  for (const w of windData) {
    const { hourKey } = parseHourKey(w.deliveryDate, w.hourEnding);
    if (!windByHourZone.has(hourKey)) {
      windByHourZone.set(hourKey, new Map<string, number>());
    }
    const zoneMap = windByHourZone.get(hourKey)!;
    const actual = w.actual ?? w.stppf ?? 0;
    const region = w.geoRegion || 'SYSTEM';
    const targetZones = GEO_REGION_TO_ZONES[region.toUpperCase()] || GEO_REGION_TO_ZONES['SYSTEM'];
    const perZone = actual / targetZones.length;
    for (const zoneId of targetZones) {
      zoneMap.set(zoneId, (zoneMap.get(zoneId) || 0) + perZone);
    }
  }
  
  for (const s of solarData) {
    const { hourKey } = parseHourKey(s.deliveryDate, s.hourEnding);
    if (!solarByHourZone.has(hourKey)) {
      solarByHourZone.set(hourKey, new Map<string, number>());
    }
    const zoneMap = solarByHourZone.get(hourKey)!;
    const actual = s.actual ?? s.stppf ?? 0;
    const region = s.geoRegion || 'SYSTEM';
    const targetZones = GEO_REGION_TO_ZONES[region.toUpperCase()] || GEO_REGION_TO_ZONES['SYSTEM'];
    const perZone = actual / targetZones.length;
    for (const zoneId of targetZones) {
      zoneMap.set(zoneId, (zoneMap.get(zoneId) || 0) + perZone);
    }
  }
  
  const hourlySnapshots: ErcotHourlySnapshot[] = [];
  const processedHours = new Set<string>();
  
  for (const load of actualLoad) {
    const { hourKey, hourEndingNum } = parseHourKey(load.deliveryDate, load.hourEnding);
    if (processedHours.has(hourKey)) continue;
    processedHours.add(hourKey);
    
    const zones = buildZonesFromLoadData(load, windByHourZone, solarByHourZone, hourKey, true);
    hourlySnapshots.push({
      hourKey,
      deliveryDate: load.deliveryDate,
      hourEnding: hourEndingNum,
      dataType: 'actual',
      zones,
      gridSummary: computeGridSummary(zones),
    });
  }
  
  for (const forecast of loadForecast) {
    const { hourKey, hourEndingNum } = parseHourKey(forecast.deliveryDate, forecast.hourEnding);
    if (processedHours.has(hourKey)) continue;
    processedHours.add(hourKey);
    
    const zones = buildZonesFromLoadData(forecast, windByHourZone, solarByHourZone, hourKey, false);
    hourlySnapshots.push({
      hourKey,
      deliveryDate: forecast.deliveryDate,
      hourEnding: hourEndingNum,
      dataType: 'forecast',
      zones,
      gridSummary: computeGridSummary(zones),
    });
  }
  
  hourlySnapshots.sort((a, b) => a.hourKey.localeCompare(b.hourKey));
  
  const captureTime = new Date();
  const currentHour = captureTime.getHours();
  const currentDate = captureTime.toISOString().split('T')[0];
  const currentHourKey = `${currentDate} ${String(currentHour).padStart(2, '0')}:00`;
  
  const currentSnapshot = hourlySnapshots.find(h => h.hourKey === currentHourKey) || hourlySnapshots[0];
  
  return {
    cachedAt: captureTime.toISOString(),
    cacheLabel: 'LIVE',
    zones: currentSnapshot?.zones || [],
    gridSummary: currentSnapshot?.gridSummary || computeGridSummary([]),
    snapshotId: `ERCOT-LIVE-${captureTime.getTime()}`,
    hourlyData: hourlySnapshots,
    currentHourKey,
    selectedHourKey: currentHourKey,
    dataSource: 'live' as const,
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

export function clearErcotDbCache(): void {
  if (ercotDb) {
    ercotDb.close();
    ercotDb = null;
  }
  ercotDbInitFailed = false;
}

// ============================================================================
// SETTLEMENT POINT PRICES (Arb Windows)
// ============================================================================
// RT SPP: /np6-905-cd/spp_node_zone_hub (15-min real-time)
// DAM SPP: /np4-190-cd/dam_stlmnt_pnt_prices (hourly day-ahead)
// Default settlement point: HB_HUBAVG
// ============================================================================

import type { SppPrice, PriceCacheData, ArbEdge } from '@fleetfail/engine';
import { calculateArbWindows, DEFAULT_SETTLEMENT_POINT } from '@fleetfail/engine';

interface RtSppApiRecord {
  deliveryDate: string;
  deliveryHour: string;
  deliveryInterval: string;
  settlementPoint: string;
  settlementPointPrice: number;
  repeatHourFlag: string;
}

interface DamSppApiRecord {
  deliveryDate: string;
  hourEnding: string;
  settlementPoint: string;
  settlementPointPrice: number;
  settlementPointType: string;
}

/**
 * Fetch real-time settlement point prices (15-min intervals).
 * API: /np6-905-cd/spp_node_zone_hub
 * 
 * @param settlementPoint - Settlement point to filter (default: HB_HUBAVG)
 */
export async function fetchSppRealTime(
  settlementPoint: string = DEFAULT_SETTLEMENT_POINT
): Promise<SppPrice[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<RtSppApiRecord>>(
    '/np6-905-cd/spp_node_zone_hub',
    {
      params: {
        settlementPoint,
        size: 100,
        sort: encodeErcotSort(['deliveryDate desc', 'deliveryHour desc', 'deliveryInterval desc']),
      },
    }
  );
  
  const records = response.data.data || [];
  
  return records.map((record) => {
    const hour = parseInt(record.deliveryHour, 10);
    const interval = parseInt(record.deliveryInterval, 10);
    const displayHour = hour === 24 ? 0 : hour;
    const minutes = (interval - 1) * 15;
    
    return {
      settlementPoint: record.settlementPoint,
      timestamp: `${record.deliveryDate}T${String(displayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`,
      priceMwh: record.settlementPointPrice,
      hourEnding: hour,
      deliveryDate: record.deliveryDate,
    };
  });
}

/**
 * Fetch day-ahead settlement point prices (hourly).
 * API: /np4-190-cd/dam_stlmnt_pnt_prices
 * 
 * @param settlementPoint - Settlement point to filter (default: HB_HUBAVG)
 */
export async function fetchSppDayAhead(
  settlementPoint: string = DEFAULT_SETTLEMENT_POINT
): Promise<SppPrice[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<DamSppApiRecord>>(
    '/np4-190-cd/dam_stlmnt_pnt_prices',
    {
      params: {
        settlementPoint,
        size: 48,
        sort: encodeErcotSort(['deliveryDate desc', 'hourEnding desc']),
      },
    }
  );
  
  const records = response.data.data || [];
  
  return records.map((record) => {
    const hourEnding = parseInt(record.hourEnding.replace(':00', '').trim(), 10);
    const displayHour = hourEnding === 24 ? 0 : hourEnding;
    
    return {
      settlementPoint: record.settlementPoint,
      timestamp: `${record.deliveryDate}T${String(displayHour).padStart(2, '0')}:00:00.000Z`,
      priceMwh: record.settlementPointPrice,
      hourEnding,
      deliveryDate: record.deliveryDate,
    };
  });
}

/**
 * Fetch live ERCOT price data (RT + DAM) and calculate arb windows.
 * Uses serialized calls with retry logic.
 * Saves successful results to SQLite for fallback.
 * Falls back to last-good SQLite snapshot on failure.
 * 
 * @param settlementPoint - Settlement point (default: HB_HUBAVG)
 * @returns PriceCacheData with live data and calculated arb windows
 */
export async function fetchLiveErcotPrices(
  settlementPoint: string = DEFAULT_SETTLEMENT_POINT
): Promise<PriceCacheData> {
  try {
    const rtPrices = await executeWithRetry({
      execute: () => fetchSppRealTime(settlementPoint),
      description: 'RT SPP prices',
    });
    
    await sleep(STAGGER_DELAY_MS);
    
    const damPrices = await executeWithRetry({
      execute: () => fetchSppDayAhead(settlementPoint),
      description: 'DAM SPP prices',
    });
    
    const result = buildPriceCacheData(rtPrices, damPrices, settlementPoint);
    
    const db = getErcotDb();
    if (db) {
      try {
        db.saveLastGoodPrices(result);
      } catch (dbError) {
        console.warn('Failed to save ERCOT price data to SQLite cache:', dbError);
      }
    }
    
    return result;
  } catch (error) {
    console.error('ERCOT price fetch failed after retries:', error);
    
    const db = getErcotDb();
    if (db) {
      try {
        const cached = db.loadLastGoodPrices(settlementPoint);
        if (cached) {
          console.log('Falling back to last-good ERCOT price data from SQLite');
          return cached;
        }
      } catch (dbError) {
        console.warn('Failed to load ERCOT price data from SQLite cache:', dbError);
      }
    }
    
    throw error;
  }
}

function buildPriceCacheData(
  rtPrices: SppPrice[],
  damPrices: SppPrice[],
  settlementPoint: string
): PriceCacheData {
  const sortedRt = [...rtPrices].sort((a, b) => 
    b.timestamp.localeCompare(a.timestamp)
  );
  
  const sortedDam = [...damPrices].sort((a, b) => 
    a.timestamp.localeCompare(b.timestamp)
  );
  
  const currentPriceMwh = sortedRt.length > 0 ? sortedRt[0]!.priceMwh : null;
  const arbEdge = calculateArbWindows(sortedDam);
  
  const captureTime = new Date();
  
  return {
    cachedAt: captureTime.toISOString(),
    dataSource: 'live' as const,
    settlementPoint,
    currentPriceMwh,
    rtPrices: sortedRt,
    damPrices: sortedDam,
    arbEdge,
    snapshotId: `ERCOT-PRICES-LIVE-${captureTime.getTime()}`,
  };
}
