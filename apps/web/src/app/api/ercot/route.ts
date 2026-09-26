import { NextResponse } from 'next/server';
import { 
  ERCOT_ZONES, 
  IL_ZONES,
  getZoneAllocations, 
  COMBINED_REAL_FIXTURE,
  type ErcotCacheData,
  type GridZone,
  type GridStatus,
} from '@fleetfail/engine';
import { getOrchestrator } from '@/lib/orchestrator-state';
import { fetchLiveErcotData, hasErcotCredentials } from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';

let cachedLiveData: { data: ErcotCacheData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getErcotCacheData(): Promise<ErcotCacheData> {
  const now = Date.now();
  
  if (cachedLiveData && (now - cachedLiveData.fetchedAt) < CACHE_TTL_MS) {
    return cachedLiveData.data;
  }
  
  if (hasErcotCredentials()) {
    try {
      const liveData = await fetchLiveErcotData();
      cachedLiveData = { data: liveData, fetchedAt: now };
      return liveData;
    } catch (error) {
      console.error('Failed to fetch live ERCOT data, falling back to fixture:', error);
    }
  }
  
  return COMBINED_REAL_FIXTURE;
}

function deriveZonesFromCache(cacheData: ErcotCacheData): GridZone[] {
  const zoneMap = new Map(cacheData.zones.map(z => [z.zoneId, z]));
  
  const derivedErcotZones: GridZone[] = ERCOT_ZONES.map(zone => {
    const cached = zoneMap.get(zone.id);
    if (cached) {
      return {
        ...zone,
        netLoadMw: cached.netLoadMw,
        temperatureF: cached.temperatureF,
        windMw: cached.windMw,
        solarMw: cached.solarMw,
      };
    }
    return zone;
  });
  
  const derivedIlZones: GridZone[] = IL_ZONES.map(zone => {
    const cached = zoneMap.get(zone.id);
    if (cached) {
      return {
        ...zone,
        netLoadMw: cached.netLoadMw,
        temperatureF: cached.temperatureF,
        windMw: cached.windMw,
        solarMw: cached.solarMw,
      };
    }
    return zone;
  });
  
  return [...derivedErcotZones, ...derivedIlZones];
}

function deriveGridStatus(cacheData: ErcotCacheData): GridStatus {
  return {
    totalLoadMw: cacheData.gridSummary.totalLoadMw,
    renewablesMw: cacheData.gridSummary.totalRenewablesMw,
    renewablePercent: cacheData.gridSummary.renewablesPercent,
    avgTemperatureF: cacheData.zones.length > 0 
      ? cacheData.zones.reduce((sum, z) => sum + z.temperatureF, 0) / cacheData.zones.length
      : 85,
    timestamp: Date.now(),
  };
}

export async function GET() {
  const orchestrator = getOrchestrator();
  const devices = orchestrator.getDevices();
  const zoneAllocations = getZoneAllocations(devices);
  
  const cacheData = await getErcotCacheData();
  const zones = deriveZonesFromCache(cacheData);
  const gridStatus = deriveGridStatus(cacheData);
  
  return NextResponse.json({
    zones,
    zoneAllocations,
    gridStatus,
    cacheLabel: cacheData.cacheLabel,
  });
}
