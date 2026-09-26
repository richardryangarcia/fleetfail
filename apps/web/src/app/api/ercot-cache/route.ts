import { NextResponse } from 'next/server';
import { getCombinedFixtureWithHourlyData, type ErcotCacheData } from '@fleetfail/engine';
import { fetchLiveErcotData, hasErcotCredentials } from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';

let cachedLiveData: { data: ErcotCacheData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const selectedHourKey = searchParams.get('hourKey');
  
  const now = Date.now();
  
  let data: ErcotCacheData;
  
  if (cachedLiveData && (now - cachedLiveData.fetchedAt) < CACHE_TTL_MS) {
    data = cachedLiveData.data;
  } else if (hasErcotCredentials()) {
    try {
      const liveData = await fetchLiveErcotData();
      cachedLiveData = { data: liveData, fetchedAt: now };
      data = liveData;
    } catch (error) {
      console.error('Failed to fetch live ERCOT data, falling back to fixture:', error);
      data = getCombinedFixtureWithHourlyData();
      data.cacheLabel = 'Cached / Replay (Fixture Sep 2024)';
    }
  } else {
    data = getCombinedFixtureWithHourlyData();
    data.cacheLabel = 'Cached / Replay (Fixture Sep 2024)';
  }
  
  if (selectedHourKey && data.hourlyData) {
    const selectedSnapshot = data.hourlyData.find(h => h.hourKey === selectedHourKey);
    if (selectedSnapshot) {
      return NextResponse.json({
        ...data,
        zones: selectedSnapshot.zones,
        gridSummary: selectedSnapshot.gridSummary,
        selectedHourKey,
      });
    }
  }
  
  return NextResponse.json(data);
}
