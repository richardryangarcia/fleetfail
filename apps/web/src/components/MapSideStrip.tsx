'use client';

import type { FleetMetrics, Dispatch, ErcotCacheData } from '@fleetfail/engine';
import Link from 'next/link';

interface MapSideStripProps {
  metrics: FleetMetrics;
  dispatch: Dispatch | null;
  ercotData: ErcotCacheData | null;
  isRunning: boolean;
  onStartDispatch: (targetKw: number) => void;
  onMassOutage?: (zoneId?: string) => void;
  onRestoreAll?: () => void;
}

function MetricRow({ label, value, unit, color }: { label: string; value: number | string; unit?: string; color?: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-slate-400 text-sm">{label}</span>
      <span className={`font-mono text-sm ${color || 'text-white'}`}>
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span className="text-slate-500 ml-1">{unit}</span>}
      </span>
    </div>
  );
}

export function MapSideStrip({
  metrics,
  dispatch,
  ercotData,
  isRunning,
  onStartDispatch,
  onMassOutage,
  onRestoreAll,
}: MapSideStripProps) {
  const progressPct = dispatch && dispatch.targetKw > 0
    ? (dispatch.deliveredKw / dispatch.targetKw) * 100
    : 0;

  return (
    <div className="w-80 bg-slate-900 border-l border-slate-700 flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">FleetFail Map ⚡</h2>
          <Link 
            href="/" 
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Ops Console →
          </Link>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          TX (ERCOT) + IL (MISO) Fleet
        </p>
      </div>

      {/* ERCOT Cache Banner */}
      {ercotData && (
        <div className="p-3 bg-gradient-to-r from-blue-900/50 to-purple-900/50 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400 font-semibold px-1.5 py-0.5 bg-amber-900/50 rounded">
              {ercotData.cacheLabel}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-slate-400">Grid Load</span>
              <div className="font-mono text-white">
                {(ercotData.gridSummary.totalLoadMw / 1000).toFixed(1)} GW
              </div>
            </div>
            <div>
              <span className="text-slate-400">Renewables</span>
              <div className="font-mono text-green-400">
                {ercotData.gridSummary.renewablesPercent.toFixed(1)}%
              </div>
            </div>
            <div>
              <span className="text-slate-400">Wind</span>
              <div className="font-mono text-cyan-400">
                {(ercotData.gridSummary.totalWindMw / 1000).toFixed(1)} GW
              </div>
            </div>
            <div>
              <span className="text-slate-400">Solar</span>
              <div className="font-mono text-yellow-400">
                {(ercotData.gridSummary.totalSolarMw / 1000).toFixed(1)} GW
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Status */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold">Dispatch</span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            isRunning ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'
          }`}>
            {isRunning ? 'RUNNING' : 'IDLE'}
          </span>
        </div>
        
        {dispatch ? (
          <>
            <MetricRow 
              label="Target" 
              value={dispatch.targetKw} 
              unit="kW" 
              color="text-blue-400" 
            />
            <MetricRow 
              label="Delivered" 
              value={dispatch.deliveredKw} 
              unit="kW" 
              color="text-green-400" 
            />
            <div className="mt-2">
              <div className="w-full bg-slate-700 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full transition-all duration-300 ${
                    progressPct >= 99 ? 'bg-green-500' : progressPct >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, progressPct)}%` }}
                />
              </div>
              <div className="text-right text-xs text-slate-500 mt-1">
                {progressPct.toFixed(1)}% complete
              </div>
            </div>
          </>
        ) : (
          <div className="text-slate-500 text-sm">No active dispatch</div>
        )}
        
        <button
          onClick={() => onStartDispatch(400)}
          disabled={dispatch?.status === 'executing'}
          className="w-full mt-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded text-sm font-semibold transition-colors"
        >
          Start 400kW Dispatch
        </button>
      </div>

      {/* Fleet Metrics */}
      <div className="p-4 border-b border-slate-700">
        <div className="text-sm font-semibold mb-2">Fleet Status</div>
        <MetricRow label="Online" value={metrics.devicesOnline} color="text-green-400" />
        <MetricRow label="Offline" value={metrics.devicesOffline} color="text-red-400" />
        <MetricRow label="Total" value={metrics.totalDevices} />
      </div>

      {/* Invariant Counters */}
      <div className="p-4 border-b border-slate-700">
        <div className="text-sm font-semibold mb-2">Invariant Counters</div>
        <MetricRow label="Duplicates Ignored" value={metrics.duplicatesIgnored} color="text-purple-400" />
        <MetricRow label="Stale Rejected" value={metrics.staleRejected} color="text-orange-400" />
        <MetricRow label="Reallocations" value={metrics.reallocations} color="text-cyan-400" />
        <MetricRow label="Pending Cmds" value={metrics.pendingCommands} color="text-yellow-400" />
      </div>

      {/* Fault Injection */}
      <div className="p-4 border-b border-slate-700">
        <div className="text-sm font-semibold mb-2">Fault Injection</div>
        {onMassOutage && (
          <button
            onClick={() => onMassOutage()}
            className="w-full py-2 bg-red-800 hover:bg-red-700 rounded text-sm font-semibold mb-2"
          >
            Mass Outage (10 devices)
          </button>
        )}
        {onRestoreAll && (
          <button
            onClick={onRestoreAll}
            className="w-full py-2 bg-green-800 hover:bg-green-700 rounded text-sm font-semibold"
          >
            Restore All Devices
          </button>
        )}
      </div>

      {/* Zone Stress (from cached ERCOT) */}
      {ercotData && (
        <div className="p-4 flex-1">
          <div className="text-sm font-semibold mb-2">Zone Net Load (Cached)</div>
          <div className="space-y-1">
            {ercotData.zones
              .sort((a, b) => b.netLoadMw - a.netLoadMw)
              .map(zone => (
                <div 
                  key={zone.zoneId} 
                  className="flex justify-between items-center text-xs cursor-pointer hover:bg-slate-800 px-1 py-0.5 rounded"
                  onClick={() => onMassOutage?.(zone.zoneId)}
                >
                  <span className="text-slate-400">{zone.zoneName}</span>
                  <span className="font-mono text-slate-300">
                    {(zone.netLoadMw / 1000).toFixed(1)} GW
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="p-3 bg-slate-950 border-t border-slate-700 text-xs text-slate-600">
        <p className="font-semibold text-slate-500">⚠️ SYNTHETIC DATA</p>
        <p>Map markers are synthetic zone clusters, not real Base installations.</p>
      </div>
    </div>
  );
}
