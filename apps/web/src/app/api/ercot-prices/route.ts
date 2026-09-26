/**
 * ERCOT Settlement Point Prices API
 * 
 * Returns real-time and day-ahead settlement point prices for arb window calculation.
 * Default settlement point: HB_HUBAVG
 * 
 * HONESTY POLICY:
 * - dataSource: 'live' when credentials present AND fetch succeeds
 * - dataSource: 'cached' ONLY if real captured snapshot exists
 * - If no credentials and no snapshot: returns unavailable state (no invented prices)
 * 
 * Endpoints fetched:
 * - RT SPP: /np6-905-cd/spp_node_zone_hub (15-min)
 * - DAM SPP: /np4-190-cd/dam_stlmnt_pnt_prices (hourly)
 */

import { NextResponse } from 'next/server';
import { createUnavailablePriceCache, DEFAULT_SETTLEMENT_POINT, type PriceCacheData } from '@fleetfail/engine';
import { fetchLiveErcotPrices, hasErcotCredentials } from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';

let cachedPriceData: { data: PriceCacheData; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000; // 1 minute for prices (more volatile than load)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const settlementPoint = searchParams.get('settlementPoint') || DEFAULT_SETTLEMENT_POINT;
  
  const now = Date.now();
  
  // Return cached data if still fresh
  if (
    cachedPriceData && 
    cachedPriceData.data.settlementPoint === settlementPoint &&
    (now - cachedPriceData.fetchedAt) < CACHE_TTL_MS
  ) {
    return NextResponse.json(cachedPriceData.data);
  }
  
  // Try to fetch live data if credentials are present
  if (hasErcotCredentials()) {
    try {
      const liveData = await fetchLiveErcotPrices(settlementPoint);
      cachedPriceData = { data: liveData, fetchedAt: now };
      return NextResponse.json(liveData);
    } catch (error) {
      console.error('Failed to fetch live ERCOT price data:', error);
      // Fall through to unavailable state
    }
  }
  
  // No credentials or fetch failed - return unavailable state
  // Per PRD: "prefer empty/unavailable for prices if no real sample was captured"
  // NEVER invent SPP numbers
  const unavailable = createUnavailablePriceCache(settlementPoint);
  return NextResponse.json(unavailable);
}
