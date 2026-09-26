import { NextResponse } from 'next/server';
import { createCachedLoadPreferences, COMBINED_REAL_FIXTURE, type ErcotCacheData } from '@fleetfail/engine';
import { getOrchestrator, startSimulation, getSimulationState } from '@/lib/orchestrator-state';
import { fetchLiveErcotData, hasErcotCredentials } from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';

let cachedErcotData: { data: ErcotCacheData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function getErcotCacheForPreferences(): Promise<ErcotCacheData> {
  const now = Date.now();
  
  if (cachedErcotData && (now - cachedErcotData.fetchedAt) < CACHE_TTL_MS) {
    return cachedErcotData.data;
  }
  
  if (hasErcotCredentials()) {
    try {
      const liveData = await fetchLiveErcotData();
      cachedErcotData = { data: liveData, fetchedAt: now };
      return liveData;
    } catch (error) {
      console.error('Failed to fetch live ERCOT data for dispatch preferences:', error);
    }
  }
  
  return COMBINED_REAL_FIXTURE;
}

export async function POST(request: Request) {
  const body = await request.json();
  const targetKw = body.targetKw ?? 400;
  
  const orchestrator = getOrchestrator();
  
  const cacheData = await getErcotCacheForPreferences();
  const txZones = cacheData.zones.filter(z => !z.zoneId.startsWith('IL_'));
  const txOnlyCache: ErcotCacheData = {
    ...cacheData,
    zones: txZones,
    gridSummary: {
      ...cacheData.gridSummary,
      totalLoadMw: txZones.reduce((sum, z) => sum + z.loadMw, 0),
      totalWindMw: txZones.reduce((sum, z) => sum + z.windMw, 0),
      totalSolarMw: txZones.reduce((sum, z) => sum + z.solarMw, 0),
      totalRenewablesMw: txZones.reduce((sum, z) => sum + z.windMw + z.solarMw, 0),
    },
  };
  
  const txPreferences = createCachedLoadPreferences(txOnlyCache);
  orchestrator.setZonePreferences(txPreferences);
  
  const dispatch = orchestrator.startDispatch(targetKw);
  startSimulation();
  
  return NextResponse.json({
    dispatch,
    state: getSimulationState(),
  });
}
