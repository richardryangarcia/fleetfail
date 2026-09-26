import { NextResponse } from 'next/server';
import { getErcotCache } from '@fleetfail/engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cacheData = getErcotCache();
  return NextResponse.json(cacheData);
}
