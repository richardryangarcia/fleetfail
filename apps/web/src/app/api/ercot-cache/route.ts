import { NextResponse } from 'next/server';
import { getErcotCache, COMBINED_REAL_FIXTURE, type ErcotCacheData } from '@fleetfail/engine';
import { fetchLiveErcotData, hasErcotCredentials } from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';

let cachedLiveData: { data: ErcotCacheData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET() {
  const now = Date.now();
  
  if (cachedLiveData && (now - cachedLiveData.fetchedAt) < CACHE_TTL_MS) {
    return NextResponse.json(cachedLiveData.data);
  }
  
  if (hasErcotCredentials()) {
    try {
      const liveData = await fetchLiveErcotData();
      cachedLiveData = { data: liveData, fetchedAt: now };
      return NextResponse.json(liveData);
    } catch (error) {
      console.error('Failed to fetch live ERCOT data, falling back to fixture:', error);
    }
  }
  
  const fixtureData: ErcotCacheData = {
    ...COMBINED_REAL_FIXTURE,
    cacheLabel: 'Cached / Replay (Fixture Sep 2024)',
  };
  
  return NextResponse.json(fixtureData);
}
