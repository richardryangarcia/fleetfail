import { NextResponse } from 'next/server';
import { executeBackfill, isBackfillBlocked, hasErcotCredentials } from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/ercot-backfill
 * 
 * Manual trigger to backfill ~7 days of ERCOT actual load data.
 * NOT called from normal polling - demo/admin trigger only.
 * 
 * Rate-limit aware:
 * - Respects circuit breaker
 * - Paginates with delays between requests
 * - Returns partial progress on 429
 * - Never writes empty/corrupt last-good
 * 
 * Response: { ok, hoursWritten, actualHours, forecastHours, range, uniqueDates, dataSource, throttled?, retryAfterSec?, error? }
 */
export async function POST(request: Request) {
  if (!hasErcotCredentials()) {
    return NextResponse.json({
      ok: false,
      error: 'ERCOT credentials not configured',
      hoursWritten: 0,
      actualHours: 0,
      forecastHours: 0,
      range: { first: null, last: null },
      uniqueDates: [],
      dataSource: 'error',
      pagesCompleted: 0,
      durationMs: 0,
    }, { status: 503 });
  }
  
  const blocked = isBackfillBlocked();
  if (blocked.blocked) {
    return NextResponse.json({
      ok: false,
      error: 'ERCOT rate limited - circuit breaker open',
      throttled: true,
      retryAfterSec: blocked.retryAfterSec,
      hoursWritten: 0,
      actualHours: 0,
      forecastHours: 0,
      range: { first: null, last: null },
      uniqueDates: [],
      dataSource: 'error',
      pagesCompleted: 0,
      durationMs: 0,
    }, { status: 429, headers: { 'Retry-After': String(blocked.retryAfterSec ?? 60) } });
  }
  
  try {
    const result = await executeBackfill();
    
    const status = result.ok ? 200 : (result.throttled ? 429 : 500);
    const headers: Record<string, string> = {};
    
    if (result.throttled && result.retryAfterSec) {
      headers['Retry-After'] = String(result.retryAfterSec);
    }
    
    return NextResponse.json(result, { status, headers });
  } catch (error) {
    console.error('Backfill failed with unexpected error:', error);
    return NextResponse.json({
      ok: false,
      error: `Unexpected error: ${(error as Error).message}`,
      hoursWritten: 0,
      actualHours: 0,
      forecastHours: 0,
      range: { first: null, last: null },
      uniqueDates: [],
      dataSource: 'error',
      pagesCompleted: 0,
      durationMs: 0,
    }, { status: 500 });
  }
}

/**
 * GET /api/ercot-backfill?confirm=true
 * 
 * Alternative to POST - requires explicit confirm query param.
 * Useful for testing from browser.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const confirm = searchParams.get('confirm');
  
  if (confirm !== 'true') {
    return NextResponse.json({
      message: 'Backfill endpoint - add ?confirm=true to execute',
      blocked: isBackfillBlocked(),
      hasCredentials: hasErcotCredentials(),
    });
  }
  
  return POST(request);
}
