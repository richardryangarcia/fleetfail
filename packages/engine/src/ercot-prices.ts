/**
 * ERCOT Settlement Point Price Types
 * 
 * SOURCE: ERCOT Public API
 * - RT SPP: /np6-905-cd/spp_node_zone_hub (15-min real-time)
 * - DAM SPP: /np4-190-cd/dam_stlmnt_pnt_prices (hourly day-ahead)
 * 
 * Default settlement point: HB_HUBAVG (ERCOT Hub Average)
 * 
 * HONESTY POLICY: Price data follows strict honesty rules:
 * - LIVE: credentials present AND fetch succeeded
 * - Cached/Replay: only if real captured snapshot exists
 * - Empty/unavailable: if no real data; NEVER invent SPP numbers
 */

import type { ErcotDataSource } from './ercot-cache.js';

/** Settlement point price for a single interval */
export interface SppPrice {
  /** Settlement point name (e.g., HB_HUBAVG) */
  settlementPoint: string;
  /** Timestamp (ISO string) */
  timestamp: string;
  /** Price in $/MWh */
  priceMwh: number;
  /** Hour ending (1-24 for DAM, derived for RT) */
  hourEnding: number;
  /** Delivery date (YYYY-MM-DD) */
  deliveryDate: string;
}

/** Arb window recommendation */
export interface ArbWindow {
  /** Start hour timestamp (ISO) */
  startTime: string;
  /** End hour timestamp (ISO) */
  endTime: string;
  /** Hour ending for display */
  hourEnding: number;
  /** Price at this window ($/MWh) */
  priceMwh: number;
  /** Window type */
  type: 'charge' | 'discharge';
}

/** Arb edge calculation result */
export interface ArbEdge {
  /** Whether there's a viable arb opportunity */
  hasEdge: boolean;
  /** Spread: discharge price - charge price ($/MWh) */
  spreadMwh: number;
  /** Best charge window (buy low) */
  chargeWindow: ArbWindow | null;
  /** Best discharge window (sell high) */
  dischargeWindow: ArbWindow | null;
  /** Human-readable explanation */
  explanation: string;
}

/** Price data cache structure */
export interface PriceCacheData {
  /** When data was cached (ISO timestamp) */
  cachedAt: string;
  /** Data source: 'live' or 'cached' */
  dataSource: ErcotDataSource;
  /** Settlement point name */
  settlementPoint: string;
  /** Current/most recent RT price ($/MWh), null if unavailable */
  currentPriceMwh: number | null;
  /** Real-time prices (15-min intervals) */
  rtPrices: SppPrice[];
  /** Day-ahead prices (hourly) */
  damPrices: SppPrice[];
  /** Calculated arb windows */
  arbEdge: ArbEdge;
  /** Snapshot ID for tracking */
  snapshotId: string;
}

/** Minimum edge threshold for viable arb ($/MWh) */
export const ARB_EDGE_THRESHOLD_MWH = 5;

/** Default settlement point */
export const DEFAULT_SETTLEMENT_POINT = 'HB_HUBAVG';

/** DAM horizon hours for window calculation */
export const DAM_HORIZON_HOURS = 24;

/**
 * Calculate arb windows from DAM prices.
 * 
 * Algorithm:
 * 1. Over next 24 DAM hours, find argmin (charge) and argmax (discharge)
 * 2. Require (discharge - charge) >= $5/MWh edge threshold
 * 3. If no viable edge, return hasEdge: false with "no arb edge" message
 * 
 * @param damPrices - Array of DAM settlement point prices
 * @returns ArbEdge with charge/discharge windows or no-edge indication
 */
export function calculateArbWindows(damPrices: SppPrice[]): ArbEdge {
  if (damPrices.length === 0) {
    return {
      hasEdge: false,
      spreadMwh: 0,
      chargeWindow: null,
      dischargeWindow: null,
      explanation: 'No DAM price data available',
    };
  }

  // Sort by timestamp to get chronological order
  const sortedPrices = [...damPrices].sort((a, b) => 
    a.timestamp.localeCompare(b.timestamp)
  );

  // Take next 24 hours
  const horizonPrices = sortedPrices.slice(0, DAM_HORIZON_HOURS);

  if (horizonPrices.length === 0) {
    return {
      hasEdge: false,
      spreadMwh: 0,
      chargeWindow: null,
      dischargeWindow: null,
      explanation: 'No DAM price data in horizon',
    };
  }

  // Find argmin (charge window - buy low)
  let minPrice = horizonPrices[0]!;
  for (const price of horizonPrices) {
    if (price.priceMwh < minPrice.priceMwh) {
      minPrice = price;
    }
  }

  // Find argmax (discharge window - sell high)
  let maxPrice = horizonPrices[0]!;
  for (const price of horizonPrices) {
    if (price.priceMwh > maxPrice.priceMwh) {
      maxPrice = price;
    }
  }

  const spreadMwh = maxPrice.priceMwh - minPrice.priceMwh;
  const hasEdge = spreadMwh >= ARB_EDGE_THRESHOLD_MWH;

  const chargeWindow: ArbWindow = {
    startTime: minPrice.timestamp,
    endTime: minPrice.timestamp,
    hourEnding: minPrice.hourEnding,
    priceMwh: minPrice.priceMwh,
    type: 'charge',
  };

  const dischargeWindow: ArbWindow = {
    startTime: maxPrice.timestamp,
    endTime: maxPrice.timestamp,
    hourEnding: maxPrice.hourEnding,
    priceMwh: maxPrice.priceMwh,
    type: 'discharge',
  };

  return {
    hasEdge,
    spreadMwh,
    chargeWindow,
    dischargeWindow,
    explanation: hasEdge
      ? `$${spreadMwh.toFixed(2)}/MWh spread (charge @$${minPrice.priceMwh.toFixed(2)}, discharge @$${maxPrice.priceMwh.toFixed(2)})`
      : `No arb edge — spread $${spreadMwh.toFixed(2)}/MWh < $${ARB_EDGE_THRESHOLD_MWH} threshold`,
  };
}

/**
 * Create an empty/unavailable price cache.
 * Used when no credentials and no real cached snapshot exists.
 * NEVER invents SPP numbers.
 */
export function createUnavailablePriceCache(settlementPoint: string = DEFAULT_SETTLEMENT_POINT): PriceCacheData {
  return {
    cachedAt: new Date().toISOString(),
    dataSource: 'cached',
    settlementPoint,
    currentPriceMwh: null,
    rtPrices: [],
    damPrices: [],
    arbEdge: {
      hasEdge: false,
      spreadMwh: 0,
      chargeWindow: null,
      dischargeWindow: null,
      explanation: 'Price data unavailable — ERCOT credentials not configured',
    },
    snapshotId: 'UNAVAILABLE',
  };
}
