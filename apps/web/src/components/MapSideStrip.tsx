'use client';

import { useState } from 'react';
import type { FleetMetrics, Dispatch, ErcotCacheData, PriceCacheData, ArbWindow } from '@fleetfail/engine';
import { findPriceForHourKey, findArbWindowsForHourKey } from '@fleetfail/engine/ercot-prices';
import Link from 'next/link';

const MAP_DEFAULT_TARGET_KW = 1500;

export interface ArbModeState {
  armed: boolean;
  chargeWindow: ArbWindow | null;
  dischargeWindow: ArbWindow | null;
  spreadMwh: number;
  armedAt: number | null;
}

export interface AutoFireStatus {
  /** Whether auto-dispatch has fired for the current armed discharge window */
  fired: boolean;
  /** The hour (wall clock) at which auto-dispatch will fire */
  scheduledHour: number | null;
  /** Human-readable status message */
  message: string;
}

interface MapSideStripProps {
  metrics: FleetMetrics;
  dispatch: Dispatch | null;
  ercotData: ErcotCacheData | null;
  priceData: PriceCacheData | null;
  selectedHourKey?: string | null;
  isRunning: boolean;
  arbMode: ArbModeState | null;
  autoFireStatus: AutoFireStatus | null;
  onStartDispatch: (targetKw: number) => void;
  onMassOutage?: (zoneId?: string) => void;
  onRestoreAll?: () => void;
  onArmArb?: () => void;
  onDisarmArb?: () => void;
  onExecuteArb?: (windowType: 'charge' | 'discharge', targetKw: number) => void;
}

function MetricRow({ label, value, unit, variant }: { label: string; value: number | string; unit?: string; variant?: 'ok' | 'bad' | 'accent' | 'warn' | 'mute' }) {
  const valueColor = variant === 'ok' ? 'text-nc-ok' 
    : variant === 'bad' ? 'text-nc-bad'
    : variant === 'accent' ? 'text-nc-accent'
    : variant === 'warn' ? 'text-nc-warn'
    : variant === 'mute' ? 'text-nc-ink-dim'
    : 'text-nc-num';
  
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-nc-ink-mute text-[11px] uppercase tracking-wide">{label}</span>
      <span className={`font-mono text-sm tabular-nums ${valueColor}`}>
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span className="text-nc-ink-dim text-[10px] ml-1">{unit}</span>}
      </span>
    </div>
  );
}

export function MapSideStrip({
  metrics,
  dispatch,
  ercotData,
  priceData,
  selectedHourKey = null,
  isRunning,
  arbMode,
  autoFireStatus,
  onStartDispatch,
  onMassOutage,
  onRestoreAll,
  onArmArb,
  onDisarmArb,
  onExecuteArb,
}: MapSideStripProps) {
  const [targetKw, setTargetKw] = useState(MAP_DEFAULT_TARGET_KW);
  const [arbTargetKw, setArbTargetKw] = useState(1000);
  
  const progressPct = dispatch && dispatch.targetKw > 0
    ? (dispatch.deliveredKw / dispatch.targetKw) * 100
    : 0;
  
  const safeMetrics = {
    deliveredKw: metrics?.deliveredKw ?? 0,
    reallocations: metrics?.reallocations ?? 0,
    devicesOnline: metrics?.devicesOnline ?? 0,
    devicesOffline: metrics?.devicesOffline ?? 0,
    duplicatesIgnored: metrics?.duplicatesIgnored ?? 0,
    staleRejected: metrics?.staleRejected ?? 0,
    pendingCommands: metrics?.pendingCommands ?? 0,
  };

  const hourPrice = findPriceForHourKey(priceData, selectedHourKey);
  const hourPriceLabel = hourPrice
    ? hourPrice.source === 'dam' ? 'DAM' : 'RT'
    : null;
  // Display-only: charge/discharge track selectedHourKey. Arm still uses wall-clock arbEdge.
  const displayArb = findArbWindowsForHourKey(priceData, selectedHourKey);
  const hourSummary =
    (selectedHourKey && ercotData?.hourlyData?.find(h => h.hourKey === selectedHourKey)?.gridSummary)
    || ercotData?.gridSummary
    || null;
  const hasRenewables =
    hourSummary != null &&
    typeof hourSummary.totalWindMw === 'number' &&
    typeof hourSummary.totalSolarMw === 'number';
  const netLoadMw = hasRenewables && hourSummary
    ? hourSummary.totalLoadMw - hourSummary.totalWindMw - hourSummary.totalSolarMw
    : null;

  return (
    <div className="w-80 bg-nc-panel border-l border-nc-line-strong flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="h-11 px-4 flex items-center justify-between border-b border-nc-line-strong bg-nc-elev shrink-0">
        <div className="flex items-baseline gap-2">
          <h1 className="text-sm font-semibold text-nc-num tracking-wide">FleetFail</h1>
          <span className="text-[11px] text-nc-ink-mute">Map</span>
        </div>
        <Link 
          href="/" 
          className="text-[10px] font-mono text-nc-ink-dim hover:text-nc-accent transition-colors"
        >
          Ops Console →
        </Link>
      </div>

      {/* Sticky Proof Strip - Hero Invariants */}
      <div className="grid grid-cols-2 border-b border-nc-line-strong bg-nc-bg shrink-0">
        <div className="p-2 border-r border-nc-line">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Delivered</div>
          <div className="text-lg font-mono font-semibold text-nc-accent tabular-nums">{safeMetrics.deliveredKw.toFixed(0)}</div>
        </div>
        <div className="p-2">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Reallocations</div>
          <div className="text-lg font-mono font-semibold text-nc-accent tabular-nums">{safeMetrics.reallocations}</div>
        </div>
        <div className="p-2 border-r border-nc-line border-t border-nc-line">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Online</div>
          <div className="text-lg font-mono font-semibold text-nc-ok tabular-nums">{safeMetrics.devicesOnline}</div>
        </div>
        <div className="p-2 border-t border-nc-line">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Offline</div>
          <div className="text-lg font-mono font-semibold text-nc-bad tabular-nums">{safeMetrics.devicesOffline}</div>
        </div>
      </div>

      {/* ERCOT Cache Banner - de-emphasized at 55% */}
      {ercotData && (
        <div className="p-3 border-b border-nc-line bg-nc-bg opacity-55">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">ERCOT Grid</span>
            <span className="text-[9px] text-nc-ink-mute tracking-wide">SYNTHETIC</span>
          </div>
          {/* ERCOT Data Source Badge */}
          <div className="mb-2">
            {ercotData.dataSource === 'live' ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#0a1810] text-nc-ok border border-[#1e4a32]">
                <span className="w-1.5 h-1.5 bg-nc-ok rounded-full animate-pulse" />
                LIVE
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-nc-panel text-nc-warn border border-nc-line">
                Cached / Replay — Live ERCOT unavailable
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div>
              <span className="text-nc-ink-mute">Load</span>
              <div className="text-nc-ink tabular-nums">
                {hourSummary
                  ? `${(hourSummary.totalLoadMw / 1000).toFixed(2)} GW`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <span className="text-nc-ink-mute">Freq</span>
              <div className="text-nc-ink tabular-nums">
                {hourSummary
                  ? `${hourSummary.frequencyHz.toFixed(2)} Hz`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <span className="text-nc-ink-mute">Wind</span>
              <div className={`tabular-nums ${hasRenewables ? 'text-nc-ink' : 'text-nc-ink-dim'}`}>
                {hasRenewables
                  ? `${(hourSummary!.totalWindMw / 1000).toFixed(2)} GW`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <span className="text-nc-ink-mute">Solar</span>
              <div className={`tabular-nums ${hasRenewables ? 'text-nc-ink' : 'text-nc-ink-dim'}`}>
                {hasRenewables
                  ? `${(hourSummary!.totalSolarMw / 1000).toFixed(2)} GW`
                  : 'Unavailable'}
              </div>
            </div>
            <div>
              <span className="text-nc-ink-mute">Net-load</span>
              <div className={`tabular-nums ${netLoadMw != null ? 'text-nc-ink' : 'text-nc-ink-dim'}`}>
                {netLoadMw != null
                  ? `${(netLoadMw / 1000).toFixed(2)} GW`
                  : 'Unavailable'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Arb Windows Price Strip */}
      <div className="p-3 border-b border-nc-line bg-[#0a0c0f]">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">
            Wholesale SPP $/MWh
          </span>
          {priceData?.dataSource === 'live' ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#0a1810] text-nc-ok border border-[#1e4a32]">
              <span className="w-1.5 h-1.5 bg-nc-ok rounded-full animate-pulse" />
              LIVE
            </span>
          ) : priceData?.currentPriceMwh !== null ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-nc-panel text-nc-warn border border-nc-line">
              Cached / Replay — Live ERCOT unavailable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-nc-panel text-nc-ink-mute border border-nc-line">
              Unavailable
            </span>
          )}
        </div>
        <div className="space-y-2">
          <div>
            <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
              Selected hour{hourPriceLabel ? <span className="ml-1 text-nc-ink-dim normal-case tracking-normal">({hourPriceLabel})</span> : null}
            </div>
            <div className="font-mono text-lg font-semibold text-nc-num tabular-nums">
              {hourPrice ? (
                <>${hourPrice.priceMwh.toFixed(2)}<span className="text-[10px] text-nc-ink-dim font-normal ml-0.5">/MWh</span></>
              ) : (
                <span className="text-nc-ink-dim text-sm font-normal">No price for hour</span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                Charge <span className="text-nc-ok">(low)</span>
              </div>
              {displayArb.chargeWindow ? (
                <div className="font-mono text-xs text-nc-ink">
                  <span className="text-nc-ok font-semibold">${displayArb.chargeWindow.priceMwh.toFixed(2)}</span>
                  <span className="text-nc-ink-dim text-[9px] ml-1">
                    @{displayArb.chargeWindow.hourEnding}:00
                  </span>
                </div>
              ) : (
                <div className="font-mono text-xs text-nc-ink-dim">Unavailable</div>
              )}
            </div>
            <div>
              <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                Discharge <span className="text-nc-accent">(high)</span>
              </div>
              {displayArb.dischargeWindow ? (
                <div className="font-mono text-xs text-nc-ink">
                  <span className="text-nc-accent font-semibold">${displayArb.dischargeWindow.priceMwh.toFixed(2)}</span>
                  <span className="text-nc-ink-dim text-[9px] ml-1">
                    @{displayArb.dischargeWindow.hourEnding}:00
                  </span>
                </div>
              ) : (
                <div className="font-mono text-xs text-nc-ink-dim">Unavailable</div>
              )}
            </div>
          </div>
          {displayArb.chargeWindow && !displayArb.hasEdge && (
            <div className="text-[9px] font-mono text-nc-warn">
              No arb edge — spread &lt;$5/MWh
            </div>
          )}
          {displayArb.hasEdge && (
            <div className="text-[9px] font-mono text-nc-ok">
              ${displayArb.spreadMwh.toFixed(2)}/MWh spread
            </div>
          )}
          {!hourPrice && (
            <div className="text-[9px] font-mono text-nc-ink-dim">
              {selectedHourKey ? 'No DAM/RT price for selected hour' : 'Price data unavailable'}
            </div>
          )}
        </div>
      </div>

      {/* Arm Arb Mode Control */}
      <div className="p-3 border-b border-nc-line bg-[#0c0a10]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">
            Arb Mode
          </span>
          {arbMode?.armed ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#1a1810] text-nc-accent border border-nc-accent-dim">
              <span className="w-1.5 h-1.5 bg-nc-accent rounded-full animate-pulse" />
              ARMED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-medium bg-nc-panel text-nc-ink-mute border border-nc-line">
              DISARMED
            </span>
          )}
        </div>
        
        {/* Auto-dispatch status (client demo automation) */}
        {arbMode?.armed && autoFireStatus && (
          <div className={`mb-2 px-2 py-1.5 text-[10px] font-mono border ${
            autoFireStatus.fired 
              ? 'bg-[#0a1810] text-nc-ok border-[#1e4a32]' 
              : 'bg-[#1a1408] text-nc-accent border-nc-accent-dim'
          }`}>
            {autoFireStatus.fired ? (
              <span className="flex items-center gap-1.5">
                <span className="text-nc-ok">✓</span>
                auto-dispatch fired
              </span>
            ) : autoFireStatus.scheduledHour !== null ? (
              <span>
                auto-dispatch at {autoFireStatus.scheduledHour}:00
                <span className="block text-[9px] text-nc-ink-mute mt-0.5">
                  (client demo · resets on reload)
                </span>
              </span>
            ) : (
              <span className="text-nc-ink-mute">no discharge window</span>
            )}
          </div>
        )}
        
        {priceData?.arbEdge?.hasEdge ? (
          <>
            {!arbMode?.armed ? (
              <button
                onClick={onArmArb}
                disabled={isRunning}
                className="w-full py-2 text-left px-3 border border-nc-accent-dim text-nc-accent bg-[#161208] hover:bg-[#1e180a] disabled:border-nc-line-strong disabled:text-nc-ink-dim disabled:bg-nc-elev text-[12px] font-medium transition-colors mb-2"
              >
                Arm Arb Mode
                <span className="block text-[10px] font-mono text-nc-ink-mute mt-0.5">
                  charge @${priceData.arbEdge.chargeWindow?.priceMwh.toFixed(2)} → discharge @${priceData.arbEdge.dischargeWindow?.priceMwh.toFixed(2)}
                </span>
              </button>
            ) : (
              <>
                <div className="mb-2">
                  <label className="block text-[10px] text-nc-ink-dim mb-1">Arb Target (kW)</label>
                  <input
                    type="number"
                    value={arbTargetKw}
                    onChange={(e) => setArbTargetKw(Number(e.target.value))}
                    className="w-full bg-nc-bg border border-nc-line-strong text-nc-num font-mono text-xs px-2 py-1.5 outline-none focus:border-nc-accent-dim"
                    min={0}
                    max={5000}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <button
                    onClick={() => onExecuteArb?.('charge', arbTargetKw)}
                    disabled={isRunning}
                    className="py-2 px-2 border border-[#1e4a32] text-nc-ok bg-[#0a1810] hover:bg-[#0e2218] disabled:border-nc-line-strong disabled:text-nc-ink-dim disabled:bg-nc-elev text-[11px] font-medium transition-colors"
                  >
                    Charge
                    <span className="block text-[9px] font-mono text-nc-ink-mute mt-0.5">
                      @${arbMode.chargeWindow?.priceMwh.toFixed(2) ?? '—'}
                    </span>
                  </button>
                  <button
                    onClick={() => onExecuteArb?.('discharge', arbTargetKw)}
                    disabled={isRunning}
                    className="py-2 px-2 border border-nc-accent-dim text-nc-accent bg-[#161208] hover:bg-[#1e180a] disabled:border-nc-line-strong disabled:text-nc-ink-dim disabled:bg-nc-elev text-[11px] font-medium transition-colors"
                  >
                    Discharge
                    <span className="block text-[9px] font-mono text-nc-ink-mute mt-0.5">
                      @${arbMode.dischargeWindow?.priceMwh.toFixed(2) ?? '—'}
                    </span>
                  </button>
                </div>
                <button
                  onClick={onDisarmArb}
                  className="w-full py-1.5 text-center px-3 border border-nc-line-strong text-nc-ink-dim bg-nc-elev hover:bg-[#151820] text-[11px] font-medium transition-colors"
                >
                  Disarm
                </button>
              </>
            )}
          </>
        ) : (
          <div className="text-[10px] font-mono text-nc-ink-dim">
            No arb edge available — spread below $5/MWh threshold
          </div>
        )}
      </div>

      {/* Dispatch Control Block */}
      <div className="p-3 border-b border-nc-line">
        <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-bold mb-2">Dispatch Control</div>
        
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-nc-ink-dim">Status</span>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold tracking-wider px-2 py-0.5 border ${
            isRunning 
              ? 'text-nc-accent border-nc-accent-dim bg-[#161208]' 
              : 'text-nc-idle border-nc-line-strong bg-nc-elev'
          }`}>
            <span className={`w-1.5 h-1.5 ${isRunning ? 'bg-nc-accent' : 'bg-nc-idle'}`}></span>
            {isRunning ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
        
        {/* Target Power Input - matches ops page pattern */}
        <div className="mb-3">
          <label className="block text-[10px] text-nc-ink-dim mb-1">Target Power (kW)</label>
          <input
            type="number"
            value={targetKw}
            onChange={(e) => setTargetKw(Number(e.target.value))}
            className="w-full bg-nc-bg border border-nc-line-strong text-nc-num font-mono text-xs px-2 py-1.5 outline-none focus:border-nc-accent-dim"
            min={0}
            max={5000}
          />
        </div>
        
        {dispatch ? (
          <>
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-xl font-mono font-semibold text-nc-num tabular-nums">
                <span className="text-nc-ink-mute text-xs font-normal mr-1">Delivered</span>
                {dispatch.deliveredKw.toFixed(0)}
                <span className="text-nc-ink-mute font-normal"> / </span>
                <span className="text-nc-ink-mute text-xs font-normal mr-1">Target</span>
                {dispatch.targetKw.toFixed(0)}
              </span>
              <span className="text-sm font-mono text-nc-accent">{Math.min(100, progressPct).toFixed(0)}%</span>
            </div>
            <div className="h-[3px] bg-nc-line-strong relative">
              <div 
                className="absolute left-0 top-0 bottom-0 bg-nc-accent transition-all duration-300"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
            {safeMetrics.reallocations > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#1a2518] text-nc-ok border border-[#2a4528]">
                  ↑ {safeMetrics.reallocations} covering slack
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="text-nc-ink-dim text-[11px] font-mono">No active dispatch</div>
        )}
        
        <button
          onClick={() => onStartDispatch(targetKw)}
          disabled={dispatch?.status === 'executing'}
          className="w-full mt-3 py-2 text-left px-3 border border-nc-accent-dim text-nc-accent bg-[#161208] hover:bg-[#1e180a] disabled:border-nc-line-strong disabled:text-nc-ink-dim disabled:bg-nc-elev text-[12px] font-medium transition-colors"
        >
          Start Dispatch
          <span className="block text-[10px] font-mono text-nc-ink-mute mt-0.5">target={targetKw}kW</span>
        </button>
      </div>

      {/* Invariant Counters */}
      <div className="p-3 border-b border-nc-line">
        <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-bold mb-2">Invariants</div>
        <MetricRow label="Dupes Ignored" value={safeMetrics.duplicatesIgnored} variant="mute" />
        <MetricRow label="Stale Rejected" value={safeMetrics.staleRejected} variant="warn" />
        <MetricRow label="Pending Cmds" value={safeMetrics.pendingCommands} variant="mute" />
      </div>

      {/* Fault Injection */}
      <div className="p-3 border-b border-nc-line">
        <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-bold mb-2">Fault Injection</div>
        {onMassOutage && (
          <button
            onClick={() => onMassOutage()}
            className="w-full py-2 text-left px-3 border border-[#5a2828] text-[#e07070] bg-nc-elev hover:bg-[#151820] text-[12px] font-medium mb-2 transition-colors"
          >
            Mass Outage
            <span className="block text-[10px] font-mono text-nc-ink-mute mt-0.5">take offline · n=100</span>
          </button>
        )}
        {onRestoreAll && (
          <button
            onClick={onRestoreAll}
            className="w-full py-2 text-left px-3 border border-[#1e4a32] text-nc-ok bg-nc-elev hover:bg-[#151820] text-[12px] font-medium transition-colors"
          >
            Restore All
            <span className="block text-[10px] font-mono text-nc-ink-mute mt-0.5">rejoin + reallocate</span>
          </button>
        )}
      </div>

      {/* Zone Stress (from cached ERCOT) - de-emphasized */}
      {ercotData && (
        <div className="p-3 flex-1 opacity-55">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-bold mb-2">
            Zone Load <span className="font-normal tracking-wide ml-1">SYNTHETIC</span>
          </div>
          <div className="space-y-0.5">
            {ercotData.zones
              .sort((a, b) => b.netLoadMw - a.netLoadMw)
              .slice(0, 6)
              .map(zone => (
                <div 
                  key={zone.zoneId} 
                  className="flex justify-between items-center text-[11px] cursor-pointer hover:bg-nc-elev px-1 py-0.5 -mx-1 transition-colors"
                  onClick={() => onMassOutage?.(zone.zoneId)}
                >
                  <span className="text-nc-ink-mute">{zone.zoneName}</span>
                  <span className="font-mono text-nc-ink tabular-nums">
                    {(zone.netLoadMw / 1000).toFixed(1)} GW
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
