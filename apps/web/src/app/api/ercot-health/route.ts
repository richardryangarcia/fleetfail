/**
 * ERCOT Health Probe API
 *
 * Diagnostic endpoint to verify Vercel Production picks up ERCOT env vars.
 * Returns JSON with credential presence checks and optional live API probe results.
 *
 * SECURITY:
 * - NEVER returns or logs actual env values, secrets, Bearer tokens, or subscription keys
 * - Error messages are sanitized to strip sensitive data
 */

import { NextResponse } from 'next/server';
import {
  fetchLiveErcotData,
  fetchLiveErcotPrices,
  hasErcotCredentials,
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

export async function GET(): Promise<NextResponse<HealthResponse>> {
  const hasCredentials = hasErcotCredentials();

  const response: HealthResponse = {
    hasCredentials,
    envPresent: {
      username: !!process.env.ERCOT_API_USERNAME,
      password: !!process.env.ERCOT_API_PASSWORD,
      subscriptionKey: !!process.env.ERCOT_PUBLIC_API_SUBSCRIPTION_KEY,
    },
    grid: {
      attempted: false,
    },
    prices: {
      attempted: false,
    },
  };

  if (!hasCredentials) {
    return NextResponse.json(response);
  }

  response.grid.attempted = true;
  try {
    const gridData = await fetchLiveErcotData();
    response.grid.dataSource = gridData.dataSource;
    response.grid.snapshotId = gridData.snapshotId;
    response.grid.cacheLabel = gridData.cacheLabel;
  } catch (error) {
    const errInfo = getSafeErrorInfo(error);
    response.grid.errorName = errInfo.name;
    response.grid.errorMessageSafe = errInfo.message;
  }

  response.prices.attempted = true;
  try {
    const priceData = await fetchLiveErcotPrices();
    response.prices.dataSource = priceData.dataSource;
    response.prices.snapshotId = priceData.snapshotId;
    response.prices.currentPriceMwh = priceData.currentPriceMwh;
  } catch (error) {
    const errInfo = getSafeErrorInfo(error);
    response.prices.errorName = errInfo.name;
    response.prices.errorMessageSafe = errInfo.message;
  }

  return NextResponse.json(response);
}
