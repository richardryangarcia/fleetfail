/**
 * ERCOT Health Probe API
 *
 * Diagnostic endpoint to verify Vercel Production picks up ERCOT env vars.
 * Returns JSON with credential presence checks and optional live API probe results.
 *
 * USAGE:
 * - GET /api/ercot-health         - Credentials check only (no live probe, no quota burn)
 * - GET /api/ercot-health?probe=1 - Full live probe (burns ERCOT API quota)
 *
 * SECURITY:
 * - NEVER returns or logs actual env values, secrets, Bearer tokens, or subscription keys
 * - Error messages are sanitized to strip sensitive data
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  fetchLiveErcotData,
  fetchLiveErcotPrices,
  hasErcotCredentials,
  RateLimitedError,
} from '@/lib/ercot-live';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface HealthResponse {
  hasCredentials: boolean;
  envPresent: {
    username: boolean;
    password: boolean;
    subscriptionKey: boolean;
  };
  probeRequested: boolean;
  circuitBreakerNote?: string;
  grid: {
    attempted: boolean;
    dataSource?: string;
    snapshotId?: string;
    cacheLabel?: string;
    errorName?: string;
    errorMessageSafe?: string;
  };
  prices: {
    attempted: boolean;
    dataSource?: string;
    snapshotId?: string;
    currentPriceMwh?: number | null;
    errorName?: string;
    errorMessageSafe?: string;
  };
}

const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi,
  /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi,
  /Ocp-Apim-Subscription-Key[:\s]+[A-Za-z0-9\-]+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi,
  /password[=:\s]+\S+/gi,
  /api[_-]?key[=:\s]+\S+/gi,
  /subscription[_-]?key[=:\s]+\S+/gi,
  /secret[=:\s]+\S+/gi,
  /token[=:\s]+\S+/gi,
];

function sanitizeErrorMessage(message: string): string {
  let sanitized = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  if (sanitized.length > 500) {
    sanitized = sanitized.slice(0, 500) + '... [truncated]';
  }
  return sanitized;
}

function getSafeErrorInfo(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeErrorMessage(error.message),
    };
  }
  if (typeof error === 'object' && error !== null) {
    const errObj = error as Record<string, unknown>;
    if ('response' in errObj && typeof errObj.response === 'object' && errObj.response !== null) {
      const resp = errObj.response as Record<string, unknown>;
      const status = resp.status;
      const statusText = resp.statusText;
      return {
        name: 'AxiosError',
        message: sanitizeErrorMessage(`HTTP ${status} ${statusText || ''}`),
      };
    }
    if ('code' in errObj && typeof errObj.code === 'string') {
      return {
        name: 'NetworkError',
        message: sanitizeErrorMessage(errObj.code),
      };
    }
  }
  return {
    name: 'UnknownError',
    message: 'An unknown error occurred',
  };
}

export async function GET(request: NextRequest): Promise<NextResponse<HealthResponse>> {
  const { searchParams } = new URL(request.url);
  const probeRequested = searchParams.get('probe') === '1';
  const hasCredentials = hasErcotCredentials();

  const response: HealthResponse = {
    hasCredentials,
    envPresent: {
      username: !!process.env.ERCOT_API_USERNAME,
      password: !!process.env.ERCOT_API_PASSWORD,
      subscriptionKey: !!process.env.ERCOT_PUBLIC_API_SUBSCRIPTION_KEY,
    },
    probeRequested,
    grid: {
      attempted: false,
    },
    prices: {
      attempted: false,
    },
  };

  // If no credentials, return early
  if (!hasCredentials) {
    return NextResponse.json(response);
  }

  // If probe not requested, return credentials-only response
  if (!probeRequested) {
    response.circuitBreakerNote = 'Add ?probe=1 to perform live ERCOT API probe (burns quota)';
    return NextResponse.json(response);
  }

  // Perform live probe
  response.grid.attempted = true;
  try {
    const gridData = await fetchLiveErcotData();
    response.grid.dataSource = gridData.dataSource;
    response.grid.snapshotId = gridData.snapshotId;
    response.grid.cacheLabel = gridData.cacheLabel;
  } catch (error) {
    if (error instanceof RateLimitedError) {
      response.grid.errorName = 'RateLimitedError';
      response.grid.errorMessageSafe = error.message;
      response.circuitBreakerNote = `Circuit breaker open, retry in ${Math.ceil(error.retryAfterMs / 1000)}s`;
    } else {
      const errInfo = getSafeErrorInfo(error);
      response.grid.errorName = errInfo.name;
      response.grid.errorMessageSafe = errInfo.message;
    }
  }

  response.prices.attempted = true;
  try {
    const priceData = await fetchLiveErcotPrices();
    response.prices.dataSource = priceData.dataSource;
    response.prices.snapshotId = priceData.snapshotId;
    response.prices.currentPriceMwh = priceData.currentPriceMwh;
  } catch (error) {
    if (error instanceof RateLimitedError) {
      response.prices.errorName = 'RateLimitedError';
      response.prices.errorMessageSafe = error.message;
      if (!response.circuitBreakerNote) {
        response.circuitBreakerNote = `Circuit breaker open, retry in ${Math.ceil(error.retryAfterMs / 1000)}s`;
      }
    } else {
      const errInfo = getSafeErrorInfo(error);
      response.prices.errorName = errInfo.name;
      response.prices.errorMessageSafe = errInfo.message;
    }
  }

  return NextResponse.json(response);
}
