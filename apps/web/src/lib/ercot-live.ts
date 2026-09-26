/**
 * ERCOT Live Public API Client
 * 
 * Server-side only - DO NOT import in client components.
 * 
 * Authenticates via OAuth2 ROPC (Resource Owner Password Credentials) flow
 * and fetches real-time data from ERCOT's public API.
 * 
 * TTL-Based Caching Strategy:
 * - Grid data (load, wind, solar): 15 minute TTL
 * - RT SPP prices: 15 minute TTL (aligned with 15-min intervals)
 * - DAM SPP prices: 24 hour TTL (once per calendar day)
 * 
 * Fallback Chain: memory cache → last-good SQLite → throw (caller handles fixture)
 * 
 * Rate Limiting:
 * - Serialized outbound calls (no Promise.all burst)
 * - Stagger delay between endpoint calls
 * - Respects Retry-After header on 429 responses
 * - Retries up to 2 times with exponential backoff
 * - If TTL not expired, returns cached without hitting network
 * 
 * Data Source Honesty:
 * - dataSource: 'live' ONLY when current request's live fetch succeeds
 * - dataSource: 'cached' for memory/SQLite cache or fixture fallback
 * 
 * Environment variables (never expose to client):
 * - ERCOT_API_USERNAME
 * - ERCOT_API_PASSWORD
 * - ERCOT_PUBLIC_API_SUBSCRIPTION_KEY
 */

import axios from 'axios';
import type { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import type { ErcotCacheData, ErcotZoneLoad, ErcotGridSummary, ErcotHourlySnapshot } from '@fleetfail/engine';
import { FleetDb } from '@fleetfail/engine';

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
// TTL CONSTANTS (Data Freshness Windows)
// ============================================================================
// These constants define how often we're allowed to hit the ERCOT API.
// UI/state polling does NOT trigger live upstream if TTL hasn't expired.
// ============================================================================

/** Grid data (load, wind, solar) - aligned with RT SPP for simplicity */
const GRID_DATA_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** RT SPP prices - matches ERCOT's 15-minute interval reporting */
const RT_SPP_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** DAM SPP prices - once per calendar day (published ~13:00 CPT for next day) */
const DAM_SPP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============================================================================
// RATE LIMITING & RETRY INFRASTRUCTURE
// ============================================================================

const MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 1000;
const STAGGER_DELAY_MS = 200;

let ercotDb: FleetDb | null = null;
let ercotDbInitFailed = false;
let ercotDbErrorLogged = false;

// ============================================================================
// MEMORY CACHE WITH TTL
// ============================================================================
// First layer of fallback chain: memory → SQLite → throw
// Memory cache prevents network calls when TTL hasn't expired.
// ============================================================================

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
}

let gridDataCache: CacheEntry<ErcotCacheData> | null = null;
let rtSppCache: Map<string, CacheEntry<SppPrice[]>> = new Map(); // keyed by settlementPoint
let damSppCache: Map<string, CacheEntry<SppPrice[]>> = new Map(); // keyed by settlementPoint

function isCacheValid<T>(cache: CacheEntry<T> | undefined | null): cache is CacheEntry<T> {
  if (!cache) return false;
  return Date.now() < cache.expiresAt;
}

function createCacheEntry<T>(data: T, ttlMs: number): CacheEntry<T> {
  const now = Date.now();
  return {
    data,
    fetchedAt: now,
    expiresAt: now + ttlMs,
  };
}

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

interface ErcotApiFieldDef {
  name: string;
  label?: string;
  dataType?: string;
  searchable?: boolean;
  sortable?: boolean;
  hasRange?: boolean;
}

interface ErcotApiResponse<T> {
  fields?: ErcotApiFieldDef[];
  data: T[] | unknown[][];
  meta?: {
    totalRecords?: number;
  };
}

/**
 * Transform ERCOT API response from positional arrays to named objects.
 * 
 * ERCOT API returns data in two formats:
 * 1. Legacy: { data: [{ field: value }, ...] } - array of objects
 * 2. Current: { fields: [...], data: [[val1, val2], ...] } - positional arrays
 * 
 * This function handles both formats and normalizes field names to camelCase.
 */
function transformErcotResponse<T>(
  response: ErcotApiResponse<T>
): T[] {
  const { fields, data } = response;
  
  if (!data || !Array.isArray(data) || data.length === 0) {
    return [];
  }
  
  const firstRow = data[0];
  
  if (fields && Array.isArray(fields) && fields.length > 0 && Array.isArray(firstRow)) {
    const fieldNames = fields.map(f => f.name);
    return (data as unknown[][]).map(row => {
      const obj: Record<string, unknown> = {};
      fieldNames.forEach((name, idx) => {
        if (idx < row.length) {
          obj[name] = row[idx];
        }
      });
      return obj as T;
    });
  }
  
  if (typeof firstRow === 'object' && firstRow !== null && !Array.isArray(firstRow)) {
    return data as T[];
  }
  
  console.warn('ERCOT API response format not recognized, returning empty array');
  return [];
}

// ============================================================================
// CLIENT-SIDE SORTING HELPERS
// ============================================================================
// ERCOT API uses separate sort & dir params and only supports single-field sorting.
// To avoid 400 errors and get consistent multi-field ordering, we omit sort params
// and sort client-side after fetching.
// ============================================================================

interface HasDeliveryDateHour {
  deliveryDate?: string;
  hourEnding?: string;
}

/**
 * Null-safe string comparison for sorting.
 * Treats undefined/null as empty string (sorts first in desc order).
 */
function safeCompareDesc(a: string | undefined | null, b: string | undefined | null): number {
  const aStr = a ?? '';
  const bStr = b ?? '';
  return bStr.localeCompare(aStr);
}

/**
 * Null-safe integer parsing for sorting.
 * Returns 0 for undefined/null/NaN values.
 */
function safeParseInt(value: string | number | undefined | null): number {
  if (value == null) return 0;
  const str = typeof value === 'number' ? String(value) : value;
  const parsed = parseInt(str.replace(':00', '').trim(), 10);
  return isNaN(parsed) ? 0 : parsed;
}

function sortByDeliveryDateHourDesc<T extends HasDeliveryDateHour>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const dateCompare = safeCompareDesc(a?.deliveryDate, b?.deliveryDate);
    if (dateCompare !== 0) return dateCompare;
    const hourA = safeParseInt(a?.hourEnding);
    const hourB = safeParseInt(b?.hourEnding);
    return hourB - hourA;
  });
}

interface HasDeliveryDateHourInterval {
  deliveryDate?: string;
  deliveryHour?: string | number;
  deliveryInterval?: string | number;
}

function sortByDeliveryDateHourIntervalDesc<T extends HasDeliveryDateHourInterval>(data: T[]): T[] {
  return [...data].sort((a, b) => {
    const dateCompare = safeCompareDesc(a?.deliveryDate, b?.deliveryDate);
    if (dateCompare !== 0) return dateCompare;
    const hourA = safeParseInt(a?.deliveryHour);
    const hourB = safeParseInt(b?.deliveryHour);
    if (hourB !== hourA) return hourB - hourA;
    const intervalA = safeParseInt(a?.deliveryInterval);
    const intervalB = safeParseInt(b?.deliveryInterval);
    return intervalB - intervalA;
  });
}

interface ActualLoadByZone {
  deliveryDate?: string;
  hourEnding?: string;
  coast?: number;
  east?: number;
  farWest?: number;
  north?: number;
  northCentral?: number;
  southCentral?: number;
  southern?: number;
  west?: number;
  systemTotal?: number;
}

interface LoadForecastByZone {
  deliveryDate?: string;
  hourEnding?: string;
  model?: string;
  coast?: number;
  east?: number;
  farWest?: number;
  north?: number;
  northCentral?: number;
  southCentral?: number;
  southern?: number;
  west?: number;
  systemTotal?: number;
}

interface WindActualForecast {
  deliveryDate?: string;
  hourEnding?: string;
  actual?: number;
  stppf?: number;
  wgrpp?: number;
  copHsl?: number;
  hsl?: number;
  geoRegion?: string;
}

interface SolarActualForecast {
  deliveryDate?: string;
  hourEnding?: string;
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
    },
  });
  
  const data = transformErcotResponse<ActualLoadByZone>(response.data);
  return sortByDeliveryDateHourDesc(data);
}

export async function fetchLoadForecastByWeatherZone(): Promise<LoadForecastByZone[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<LoadForecastByZone>>('/np3-565-cd/lf_by_model_weather_zone', {
    params: {
      size: 24,
    },
  });
  
  const data = transformErcotResponse<LoadForecastByZone>(response.data);
  return sortByDeliveryDateHourDesc(data);
}

export async function fetchWindActualAndForecast(): Promise<WindActualForecast[]> {
  const token = await getAccessToken();
  const client = createApiClient(token);
  
  const response = await client.get<ErcotApiResponse<WindActualForecast>>('/np4-742-cd/wpp_hrly_actual_fcast_geo', {
    params: {
      size: 100,
    },
  });
  
  const data = transformErcotResponse<WindActualForecast>(response.data);
  return sortByDeliveryDateHourDesc(data);
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
        },
      });
      
      const data = transformErcotResponse<SolarActualForecast>(response.data);
      if (data.length > 0) {
        return sortByDeliveryDateHourDesc(data);
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
    case 'coast': return load.coast ?? 0;
    case 'east': return load.east ?? 0;
    case 'farWest': return load.farWest ?? 0;
    case 'north': return load.north ?? 0;
    case 'northCentral': return load.northCentral ?? 0;
    case 'southCentral': return load.southCentral ?? 0;
    case 'southern': return load.southern ?? 0;
    case 'west': return load.west ?? 0;
    default: return 0;
  }
}

function parseHourKey(deliveryDate: string | undefined, hourEnding: string | undefined): { hourKey: string; hourEndingNum: number } {
  const date = deliveryDate ?? new Date().toISOString().split('T')[0];
  const hourStr = hourEnding ?? '0';
  const hourEndingNum = safeParseInt(hourStr);
  const displayHour = hourEndingNum === 24 ? 0 : hourEndingNum;
  const hourKey = `${date} ${String(displayHour).padStart(2, '0')}:00`;
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
 * Fetch all ERCOT grid data with TTL caching, serialized calls, and retry logic.
 * 
 * TTL: 15 minutes (GRID_DATA_TTL_MS)
 * Fallback chain: memory cache → SQLite last-good → throw
 * 
 * If TTL hasn't expired, returns cached data without hitting network.
 * Saves successful live results to SQLite for fallback.
 */
export async function fetchLiveErcotData(): Promise<ErcotCacheData> {
  // Check memory cache first - don't hit network if TTL valid
  if (isCacheValid(gridDataCache)) {
    return {
      ...gridDataCache.data,
      dataSource: 'cached' as const,
      cacheLabel: 'MEMORY',
    };
  }
  
  // Check SQLite cache - return if TTL would still be valid
  const db = getErcotDb();
  if (db) {
    try {
      const sqliteCached = db.loadLastGoodGrid();
      if (sqliteCached) {
        const cachedTime = new Date(sqliteCached.cachedAt).getTime();
        if (Date.now() - cachedTime < GRID_DATA_TTL_MS) {
          // Populate memory cache from SQLite
          gridDataCache = createCacheEntry(sqliteCached, GRID_DATA_TTL_MS - (Date.now() - cachedTime));
          return {
            ...sqliteCached,
            dataSource: 'cached' as const,
            cacheLabel: 'SQLITE',
          };
        }
      }
    } catch (dbError) {
      console.warn('Failed to check SQLite cache for grid data:', dbError);
    }
  }
  
  // TTL expired or no cache - fetch live data
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
    
    // Update memory cache
    gridDataCache = createCacheEntry(result, GRID_DATA_TTL_MS);
    
    // Persist to SQLite (write-only-on-success)
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
    
    // Final fallback: SQLite last-good (even if stale)
    if (db) {
      try {
        const cached = db.loadLastGoodGrid();
        if (cached) {
          console.log('Falling back to last-good ERCOT grid data from SQLite (stale)');
          return {
            ...cached,
            dataSource: 'cached' as const,
            cacheLabel: 'SQLITE-STALE',
          };
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
    if (!load.deliveryDate) continue;
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
    if (!forecast.deliveryDate) continue;
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

/**
 * Clear all memory caches. Useful for testing or forcing fresh fetches.
 */
export function clearMemoryCaches(): void {
  gridDataCache = null;
  rtSppCache.clear();
  damSppCache.clear();
}

/**
 * Clear all caches (memory + SQLite state).
 */
export function clearAllCaches(): void {
  clearMemoryCaches();
  clearErcotDbCache();
  clearTokenCache();
}

// Export TTL constants for documentation and testing
export const TTL_CONSTANTS = {
  GRID_DATA_TTL_MS,
  RT_SPP_TTL_MS,
  DAM_SPP_TTL_MS,
} as const;

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
  deliveryDate?: string;
  deliveryHour?: string | number;
  deliveryInterval?: string | number;
  settlementPoint?: string;
  settlementPointPrice?: number;
  repeatHourFlag?: string;
}

interface DamSppApiRecord {
  deliveryDate?: string;
  hourEnding?: string;
  settlementPoint?: string;
  settlementPointPrice?: number;
  settlementPointType?: string;
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
      },
    }
  );
  
  const records = sortByDeliveryDateHourIntervalDesc(transformErcotResponse<RtSppApiRecord>(response.data));
  
  return records
    .filter(record => record.deliveryDate && record.settlementPointPrice != null)
    .map((record) => {
      const hour = safeParseInt(record.deliveryHour);
      const interval = safeParseInt(record.deliveryInterval) || 1;
      const displayHour = hour === 24 ? 0 : hour;
      const minutes = (interval - 1) * 15;
      
      return {
        settlementPoint: record.settlementPoint ?? settlementPoint,
        timestamp: `${record.deliveryDate}T${String(displayHour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00.000Z`,
        priceMwh: record.settlementPointPrice!,
        hourEnding: hour,
        deliveryDate: record.deliveryDate!,
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
      },
    }
  );
  
  const records = sortByDeliveryDateHourDesc(transformErcotResponse<DamSppApiRecord>(response.data));
  
  return records
    .filter(record => record.deliveryDate && record.settlementPointPrice != null)
    .map((record) => {
      const hourEnding = safeParseInt(record.hourEnding);
      const displayHour = hourEnding === 24 ? 0 : hourEnding;
      
      return {
        settlementPoint: record.settlementPoint ?? settlementPoint,
        timestamp: `${record.deliveryDate}T${String(displayHour).padStart(2, '0')}:00:00.000Z`,
        priceMwh: record.settlementPointPrice!,
        hourEnding,
        deliveryDate: record.deliveryDate!,
      };
    });
}

/**
 * Fetch live ERCOT price data (RT + DAM) and calculate arb windows.
 * 
 * TTLs:
 * - RT SPP: 15 minutes (RT_SPP_TTL_MS) - real-time 15-min intervals
 * - DAM SPP: 24 hours (DAM_SPP_TTL_MS) - once per calendar day
 * 
 * Uses separate caches for RT and DAM to avoid re-fetching DAM unnecessarily.
 * Fallback chain per component: memory cache → SQLite last-good → throw
 * 
 * @param settlementPoint - Settlement point (default: HB_HUBAVG)
 * @returns PriceCacheData with live data and calculated arb windows
 */
export async function fetchLiveErcotPrices(
  settlementPoint: string = DEFAULT_SETTLEMENT_POINT
): Promise<PriceCacheData> {
  const db = getErcotDb();
  let rtPrices: SppPrice[] | null = null;
  let damPrices: SppPrice[] | null = null;
  let rtFromCache = false;
  let damFromCache = false;
  
  // -------------------------------------------------------------------------
  // RT SPP: Check cache (15 min TTL)
  // -------------------------------------------------------------------------
  const rtCacheEntry = rtSppCache.get(settlementPoint);
  if (isCacheValid(rtCacheEntry)) {
    rtPrices = rtCacheEntry.data;
    rtFromCache = true;
  }
  
  // -------------------------------------------------------------------------
  // DAM SPP: Check cache (24h TTL)
  // -------------------------------------------------------------------------
  const damCacheEntry = damSppCache.get(settlementPoint);
  if (isCacheValid(damCacheEntry)) {
    damPrices = damCacheEntry.data;
    damFromCache = true;
  }
  
  // -------------------------------------------------------------------------
  // Check SQLite for any missing components still within TTL
  // -------------------------------------------------------------------------
  if (db && (!rtPrices || !damPrices)) {
    try {
      const sqliteCached = db.loadLastGoodPrices(settlementPoint);
      if (sqliteCached) {
        const cachedTime = new Date(sqliteCached.cachedAt).getTime();
        const age = Date.now() - cachedTime;
        
        // Use SQLite RT prices if within TTL
        if (!rtPrices && age < RT_SPP_TTL_MS && sqliteCached.rtPrices?.length) {
          rtPrices = sqliteCached.rtPrices;
          rtSppCache.set(settlementPoint, createCacheEntry(rtPrices, RT_SPP_TTL_MS - age));
          rtFromCache = true;
        }
        
        // Use SQLite DAM prices if within TTL
        if (!damPrices && age < DAM_SPP_TTL_MS && sqliteCached.damPrices?.length) {
          damPrices = sqliteCached.damPrices;
          damSppCache.set(settlementPoint, createCacheEntry(damPrices, DAM_SPP_TTL_MS - age));
          damFromCache = true;
        }
      }
    } catch (dbError) {
      console.warn('Failed to check SQLite cache for price data:', dbError);
    }
  }
  
  // -------------------------------------------------------------------------
  // Fetch only what we need (avoiding thundering herd)
  // -------------------------------------------------------------------------
  let fetchedLive = false;
  
  try {
    if (!rtPrices) {
      rtPrices = await executeWithRetry({
        execute: () => fetchSppRealTime(settlementPoint),
        description: 'RT SPP prices',
      });
      rtSppCache.set(settlementPoint, createCacheEntry(rtPrices, RT_SPP_TTL_MS));
      fetchedLive = true;
    }
    
    // Stagger between RT and DAM if we need both
    if (!damPrices && fetchedLive) {
      await sleep(STAGGER_DELAY_MS);
    }
    
    if (!damPrices) {
      damPrices = await executeWithRetry({
        execute: () => fetchSppDayAhead(settlementPoint),
        description: 'DAM SPP prices',
      });
      damSppCache.set(settlementPoint, createCacheEntry(damPrices, DAM_SPP_TTL_MS));
      fetchedLive = true;
    }
  } catch (error) {
    console.error('ERCOT price fetch failed after retries:', error);
    
    // Final fallback: SQLite last-good (even if stale)
    if (db && (!rtPrices || !damPrices)) {
      try {
        const cached = db.loadLastGoodPrices(settlementPoint);
        if (cached) {
          console.log('Falling back to last-good ERCOT price data from SQLite (stale)');
          if (!rtPrices && cached.rtPrices?.length) rtPrices = cached.rtPrices;
          if (!damPrices && cached.damPrices?.length) damPrices = cached.damPrices;
        }
      } catch (dbError) {
        console.warn('Failed to load ERCOT price data from SQLite cache:', dbError);
      }
    }
    
    // If we still don't have data, throw
    if (!rtPrices && !damPrices) {
      throw error;
    }
  }
  
  // -------------------------------------------------------------------------
  // Build result with honesty about data source
  // -------------------------------------------------------------------------
  const result = buildPriceCacheData(
    rtPrices || [],
    damPrices || [],
    settlementPoint,
    fetchedLive && !rtFromCache && !damFromCache ? 'live' : 'cached'
  );
  
  // Persist to SQLite only if we fetched fresh live data
  if (fetchedLive && db) {
    try {
      db.saveLastGoodPrices(result);
    } catch (dbError) {
      console.warn('Failed to save ERCOT price data to SQLite cache:', dbError);
    }
  }
  
  return result;
}

function buildPriceCacheData(
  rtPrices: SppPrice[],
  damPrices: SppPrice[],
  settlementPoint: string,
  dataSource: 'live' | 'cached' = 'live'
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
    dataSource,
    settlementPoint,
    currentPriceMwh,
    rtPrices: sortedRt,
    damPrices: sortedDam,
    arbEdge,
    snapshotId: `ERCOT-PRICES-${dataSource.toUpperCase()}-${captureTime.getTime()}`,
  };
}
