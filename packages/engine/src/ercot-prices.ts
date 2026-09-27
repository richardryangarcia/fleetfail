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

export type CalculateArbWindowsOptions = {
  /**
   * ISO timestamp anchoring the DAM horizon (inclusive).
   * Display path: selectedHourKey → hourKeyToAnchorIso.
   * Default / Arm path: wall-clock now (unchanged auto-fire semantics).
   */
  anchorIso?: string | null;
};

/**
 * Convert slider hourKey (`YYYY-MM-DD HH:00`) to the same ISO form used for
 * DAM SppPrice.timestamp (`YYYY-MM-DDTHH:00:00.000Z`). Returns null if malformed.
 */
export function hourKeyToAnchorIso(hourKey: string | null | undefined): string | null {
  if (!hourKey) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}):00$/.exec(hourKey.trim());
  if (!m) return null;
  return `${m[1]}T${m[2]}:00:00.000Z`;
}

/**
 * Display helper: charge/discharge windows from DAM series in a horizon
 * anchored on selectedHourKey (not wall-clock). Honest empty when no prices.
 * Does not change server arbEdge / Arm stored windows.
 */
export function findArbWindowsForHourKey(
  priceData: PriceCacheData | null | undefined,
  hourKey: string | null | undefined,
): ArbEdge {
  if (!priceData?.damPrices?.length) {
    return {
      hasEdge: false,
      spreadMwh: 0,
      chargeWindow: null,
      dischargeWindow: null,
      explanation: 'No DAM price data available',
    };
  }
  const anchorIso = hourKeyToAnchorIso(hourKey);
  if (!anchorIso) {
    return {
      hasEdge: false,
      spreadMwh: 0,
      chargeWindow: null,
      dischargeWindow: null,
      explanation: 'No selected hour for display windows',
    };
  }
  return calculateArbWindows(priceData.damPrices, { anchorIso });
}

/**
 * Calculate arb windows from DAM prices.
 *
 * Algorithm:
 * 1. Over next 24 DAM hours from anchor, find argmin (charge) and argmax (discharge)
 * 2. Require (discharge - charge) >= $5/MWh edge threshold
 * 3. If no viable edge, return hasEdge: false with "no arb edge" message
 *
 * @param damPrices - Array of DAM settlement point prices
 * @param options.anchorIso - Optional horizon start (display = selected hour; default = now)
 * @returns ArbEdge with charge/discharge windows or no-edge indication
 */
export function calculateArbWindows(
  damPrices: SppPrice[],
  options?: CalculateArbWindowsOptions,
): ArbEdge {
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

  // Prefer the upcoming horizon from the anchor so a multi-day DAM series does not
  // pin arb windows to the oldest day in the backfill.
  // Display: anchor = selectedHourKey. Arm/server: default wall-clock now.
  const anchorIso = options?.anchorIso ?? new Date().toISOString();
  const upcoming = sortedPrices.filter((p) => p.timestamp >= anchorIso);
  // When anchored on a selected hour with no upcoming DAM points, show empty —
  // do not fall back to the oldest/recent tail (that would invent a wrong horizon).
  if (options?.anchorIso != null && upcoming.length === 0) {
    return {
      hasEdge: false,
      spreadMwh: 0,
      chargeWindow: null,
      dischargeWindow: null,
      explanation: 'No DAM price data in horizon',
    };
  }
  const horizonPrices = (
    upcoming.length > 0 ? upcoming : sortedPrices.slice(-DAM_HORIZON_HOURS)
  ).slice(0, DAM_HORIZON_HOURS);

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
 * Build the same hourKey format used by ERCOT grid hourlyData
 * (`YYYY-MM-DD HH:00`, hourEnding 24 → 00:00).
 */
export function sppHourKey(price: Pick<SppPrice, 'deliveryDate' | 'hourEnding'>): string {
  const displayHour = price.hourEnding === 24 ? 0 : price.hourEnding;
  return `${price.deliveryDate} ${String(displayHour).padStart(2, '0')}:00`;
}

export type HourScopedPriceHit = {
  priceMwh: number;
  source: 'dam' | 'rt';
  hourKey: string;
};

/**
 * Look up an honest hour-scoped SPP for a slider hourKey.
 * Prefer DAM (hourly product). Fall back to RT intervals mapped to the same hour.
 * Returns null when that hour has no price — never invent or reuse "latest RT".
 */
export function findPriceForHourKey(
  priceData: PriceCacheData | null | undefined,
  hourKey: string | null | undefined,
): HourScopedPriceHit | null {
  if (!priceData || !hourKey) return null;

  for (const p of priceData.damPrices) {
    if (sppHourKey(p) === hourKey) {
      return { priceMwh: p.priceMwh, source: 'dam', hourKey };
    }
  }

  // RT timestamps are interval starts; match any interval in that clock hour.
  for (const p of priceData.rtPrices) {
    if (sppHourKey(p) === hourKey) {
      return { priceMwh: p.priceMwh, source: 'rt', hourKey };
    }
  }

  return null;
}

/**
 * Merge DAM/RT series by hourKey (and RT timestamp), preferring incoming points
 * on conflict so a short live poll does not erase a 7-day backfill.
 */
export function mergePriceSeries(
  existing: PriceCacheData | null | undefined,
  incoming: PriceCacheData,
): PriceCacheData {
  if (!existing) return incoming;

  const damByKey = new Map<string, SppPrice>();
  for (const p of existing.damPrices) damByKey.set(sppHourKey(p), p);
  for (const p of incoming.damPrices) damByKey.set(sppHourKey(p), p);

  const rtByTs = new Map<string, SppPrice>();
  for (const p of existing.rtPrices) rtByTs.set(p.timestamp, p);
  for (const p of incoming.rtPrices) rtByTs.set(p.timestamp, p);

  const damPrices = [...damByKey.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const rtPrices = [...rtByTs.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const currentPriceMwh = incoming.currentPriceMwh ?? existing.currentPriceMwh;
  const arbEdge = calculateArbWindows(damPrices);

  return {
    ...incoming,
    currentPriceMwh,
    rtPrices,
    damPrices,
    arbEdge,
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
