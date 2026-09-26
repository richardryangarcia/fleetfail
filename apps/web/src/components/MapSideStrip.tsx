'use client';

import { useState } from 'react';
import type { FleetMetrics, Dispatch, ErcotCacheData, PriceCacheData } from '@fleetfail/engine';
import Link from 'next/link';

const MAP_DEFAULT_TARGET_KW = 1500;

interface MapSideStripProps {
  metrics: FleetMetrics;
  dispatch: Dispatch | null;
  ercotData: ErcotCacheData | null;
  priceData: PriceCacheData | null;
  isRunning: boolean;
  onStartDispatch: (targetKw: number) => void;
  onMassOutage?: (zoneId?: string) => void;
  onRestoreAll?: () => void;
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
  isRunning,
  onStartDispatch,
  onMassOutage,
  onRestoreAll,
}: MapSideStripProps) {
  const [targetKw, setTargetKw] = useState(MAP_DEFAULT_TARGET_KW);
  
  const progressPct = dispatch && dispatch.targetKw > 0
    ? (dispatch.deliveredKw / dispatch.targetKw) * 100
    : 0;

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
          <div className="text-lg font-mono font-semibold text-nc-accent tabular-nums">{metrics.deliveredKw.toFixed(0)}</div>
        </div>
        <div className="p-2">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Reallocations</div>
          <div className="text-lg font-mono font-semibold text-nc-accent tabular-nums">{metrics.reallocations}</div>
        </div>
        <div className="p-2 border-r border-nc-line border-t border-nc-line">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Online</div>
          <div className="text-lg font-mono font-semibold text-nc-ok tabular-nums">{metrics.devicesOnline}</div>
        </div>
        <div className="p-2 border-t border-nc-line">
          <div className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">Offline</div>
          <div className="text-lg font-mono font-semibold text-nc-bad tabular-nums">{metrics.devicesOffline}</div>
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
                {(ercotData.gridSummary.totalLoadMw / 1000).toFixed(2)} GW
              </div>
            </div>
            <div>
              <span className="text-nc-ink-mute">Freq</span>
              <div className="text-nc-ink tabular-nums">
                {ercotData.gridSummary.frequencyHz.toFixed(2)} Hz
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
        {priceData?.currentPriceMwh !== null ? (
          <div className="space-y-2">
            <div>
              <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">Now</div>
              <div className="font-mono text-lg font-semibold text-nc-num tabular-nums">
                ${priceData?.currentPriceMwh?.toFixed(2) || '—'}
                <span className="text-[10px] text-nc-ink-dim font-normal ml-0.5">/MWh</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                  Charge <span className="text-nc-ok">(low)</span>
                </div>
                {priceData?.arbEdge.chargeWindow ? (
                  <div className="font-mono text-xs text-nc-ink">
                    <span className="text-nc-ok font-semibold">${priceData.arbEdge.chargeWindow.priceMwh.toFixed(2)}</span>
                    <span className="text-nc-ink-dim text-[9px] ml-1">
                      @{priceData.arbEdge.chargeWindow.hourEnding}:00
                    </span>
                  </div>
                ) : (
                  <div className="font-mono text-xs text-nc-ink-dim">—</div>
                )}
              </div>
              <div>
                <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                  Discharge <span className="text-nc-accent">(high)</span>
                </div>
                {priceData?.arbEdge.dischargeWindow ? (
                  <div className="font-mono text-xs text-nc-ink">
                    <span className="text-nc-accent font-semibold">${priceData.arbEdge.dischargeWindow.priceMwh.toFixed(2)}</span>
                    <span className="text-nc-ink-dim text-[9px] ml-1">
                      @{priceData.arbEdge.dischargeWindow.hourEnding}:00
                    </span>
                  </div>
                ) : (
                  <div className="font-mono text-xs text-nc-ink-dim">—</div>
                )}
              </div>
            </div>
            {priceData?.arbEdge && !priceData.arbEdge.hasEdge && (
              <div className="text-[9px] font-mono text-nc-warn">
                No arb edge — spread &lt;$5/MWh
              </div>
            )}
            {priceData?.arbEdge?.hasEdge && (
              <div className="text-[9px] font-mono text-nc-ok">
                ${priceData.arbEdge.spreadMwh.toFixed(2)}/MWh spread
              </div>
            )}
          </div>
        ) : (
          <div className="text-nc-ink-dim text-[10px] font-mono">
            Configure ERCOT credentials for live SPP
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
            {metrics.reallocations > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[#1a2518] text-nc-ok border border-[#2a4528]">
                  ↑ {metrics.reallocations} covering slack
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
        <MetricRow label="Dupes Ignored" value={metrics.duplicatesIgnored} variant="mute" />
        <MetricRow label="Stale Rejected" value={metrics.staleRejected} variant="warn" />
        <MetricRow label="Pending Cmds" value={metrics.pendingCommands} variant="mute" />
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
            <span className="block text-[10px] font-mono text-nc-ink-mute mt-0.5">take offline · n=10</span>
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
