'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import type { Device, FleetMetrics, FleetEvent, Dispatch, Command, ErcotZone, GridStatus, ZoneAllocation, ErcotCacheData, PriceCacheData } from '@fleetfail/engine';
import { HourSlider } from '@/components/HourSlider';

interface ErcotData {
  zones: ErcotZone[];
  zoneAllocations: ZoneAllocation[];
  gridStatus: GridStatus;
}

interface SimulationState {
  devices: Device[];
  metrics: FleetMetrics;
  events: FleetEvent[];
  commands: Command[];
  activeDispatch: Dispatch | null;
  isRunning: boolean;
  currentTime: number;
}

export default function Home() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [ercotData, setErcotData] = useState<ErcotData | null>(null);
  const [cachedErcotData, setCachedErcotData] = useState<ErcotCacheData | null>(null);
  const [priceData, setPriceData] = useState<PriceCacheData | null>(null);
  const [targetKw, setTargetKw] = useState(400);
  const [loading, setLoading] = useState(false);
  const [deviceCount, setDeviceCount] = useState(50);
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const hourParam = selectedHourKey ? `?hourKey=${encodeURIComponent(selectedHourKey)}` : '';
      const [stateRes, ercotRes, cachedErcotRes, priceRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/ercot'),
        fetch(`/api/ercot-cache${hourParam}`),
        fetch('/api/ercot-prices'),
      ]);
      const [stateData, ercotDataRes, cachedErcotDataRes, priceDataRes] = await Promise.all([
        stateRes.json(),
        ercotRes.json(),
        cachedErcotRes.json(),
        priceRes.json(),
      ]);
      setState(stateData);
      setErcotData(ercotDataRes);
      setCachedErcotData(cachedErcotDataRes);
      setPriceData(priceDataRes);
      
      if (!selectedHourKey && cachedErcotDataRes.currentHourKey) {
        setSelectedHourKey(cachedErcotDataRes.currentHourKey);
      }
    } catch (error) {
      console.error('Failed to fetch state:', error);
    }
  }, [selectedHourKey]);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 500);
    return () => clearInterval(interval);
  }, [fetchState]);
  
  const handleHourChange = useCallback((hourKey: string) => {
    setSelectedHourKey(hourKey);
  }, []);

  const handleDispatch = async () => {
    setLoading(true);
    try {
      await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKw, selectedHourKey }),
      });
      await fetchState();
    } finally {
      setLoading(false);
    }
  };

  const handleInjectFault = async (deviceId: string, faultType: string) => {
    await fetch('/api/fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, faultType }),
    });
    await fetchState();
  };

  const handleRestore = async (deviceId: string) => {
    await fetch(`/api/fault?deviceId=${deviceId}`, { method: 'DELETE' });
    await fetchState();
  };

  const handleReset = async () => {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCount }),
    });
    await fetchState();
  };

  const handleMassOutage = async () => {
    if (!state) return;
    const onlineDevices = state.devices.filter(d => d.status === 'online');
    const count = Math.min(10, onlineDevices.length);
    for (let i = 0; i < count; i++) {
      await handleInjectFault(onlineDevices[i]!.id, 'offline');
    }
  };

  const handleRestoreAll = async () => {
    if (!state) return;
    for (const device of state.devices.filter(d => d.status !== 'online')) {
      await handleRestore(device.id);
    }
  };

  if (!state) {
    return (
      <div className="h-screen flex items-center justify-center bg-nc-bg">
        <div className="text-nc-ink-dim">Loading FleetFail Simulator...</div>
      </div>
    );
  }

  const { metrics, devices, events, activeDispatch, isRunning } = state;
  const progressPct = metrics.dispatchTargetKw > 0 
    ? (metrics.deliveredKw / metrics.dispatchTargetKw) * 100 
    : 0;

  const eventColors: Record<string, string> = {
    COMMAND_SENT: 'text-nc-accent',
    COMMAND_ACKED: 'text-nc-ink-dim',
    ACK_TIMEOUT: 'text-nc-warn',
    RETRY_SAME_ID: 'text-nc-accent',
    DUPLICATE_IGNORED: 'text-nc-ink-dim',
    STALE_REJECTED: 'text-nc-ink-dim',
    DEVICE_EXCLUDED: 'text-nc-ink-dim',
    REALLOCATED: 'text-nc-accent',
    DEVICE_OFFLINE: 'text-nc-bad',
    DEVICE_ONLINE: 'text-nc-ok',
    DEVICE_RECONNECTED: 'text-nc-ok',
    DISPATCH_STARTED: 'text-nc-accent',
    DISPATCH_CONVERGED: 'text-nc-ok',
    DISPATCH_PARTIAL: 'text-nc-warn',
    DISPATCH_INSUFFICIENT: 'text-nc-bad',
    COMMAND_EXPIRED: 'text-nc-ink-dim',
  };

  const formatEventMessage = (event: FleetEvent): string => {
    const details = event.details as Record<string, unknown> | undefined;
    if (event.type === 'COMMAND_SENT') {
      return `target=${metrics.dispatchTargetKw}kW ${event.commandId ? `id=${event.commandId.slice(0, 12)}` : ''}`;
    }
    if (event.type === 'DEVICE_OFFLINE' || event.type === 'DEVICE_RECONNECTED') {
      return event.deviceId ? `${event.deviceId.slice(0, 8)} ${details?.zone || ''}` : '';
    }
    if (event.type === 'REALLOCATED') {
      const kw = details?.reallocatedKw;
      return kw ? `${kw}kW redistributed` : 'power redistributed';
    }
    if (event.type === 'STALE_REJECTED') {
      return event.deviceId ? `${event.deviceId.slice(0, 8)}` : '';
    }
    if (event.deviceId) {
      return event.deviceId.slice(0, 8);
    }
    return '';
  };

  return (
    <div className="h-screen flex flex-col max-w-[1440px] mx-auto border-l border-r border-nc-line">
      {/* Header - 44px */}
      <header className="h-11 flex items-center justify-between px-4 border-b border-nc-line-strong bg-nc-elev shrink-0">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-sm font-semibold tracking-wide text-nc-num">FleetFail</h1>
          <span className="text-[11px] text-nc-ink-mute">Resilient Dispatch Simulator · Base Power × AITX</span>
        </div>
        <div className="flex items-center gap-4">
          <div className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold tracking-wider px-2 py-0.5 border ${
            isRunning 
              ? 'text-nc-accent border-nc-accent-dim bg-[#1a1408]' 
              : 'text-nc-idle border-nc-line-strong bg-nc-panel'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-[1px] ${isRunning ? 'bg-nc-accent' : 'bg-nc-idle'}`} />
            {isRunning ? 'RUNNING' : 'IDLE'}
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] text-nc-ink-dim">
            <span>devices <strong className="text-nc-num font-medium">{metrics.devicesOnline}</strong>/{devices.length}</span>
            <span>tick <strong className="text-nc-num font-medium">142ms</strong></span>
          </div>
        </div>
      </header>

      {/* Proof Strip - 36px */}
      <div className="h-9 grid grid-cols-5 border-b border-nc-line-strong bg-[#0c0e12] shrink-0">
        <ProofCell label="Delivered" value={Math.round(metrics.deliveredKw)} accent />
        <ProofCell label="Pending Cmds" value={metrics.pendingCommands} />
        <ProofCell label="Duplicates Ignored" value={metrics.duplicatesIgnored} />
        <ProofCell label="Stale Rejected" value={metrics.staleRejected} warn={metrics.staleRejected > 0} />
        <ProofCell label="Reallocations" value={metrics.reallocations} accent last />
      </div>

      {/* Body - 220px | 1fr | 340px */}
      <div className="flex-1 grid grid-cols-[220px_1fr_340px] min-h-0 overflow-hidden">
        {/* Left Verb Column */}
        <aside className="border-r border-nc-line-strong bg-nc-panel flex flex-col p-3 gap-3.5 overflow-y-auto">
          <VerbBlock title="Dispatch Control">
            <Field label="Target Power (kW)">
              <input
                type="number"
                value={targetKw}
                onChange={(e) => setTargetKw(Number(e.target.value))}
                className="w-full bg-nc-bg border border-nc-line-strong text-nc-num font-mono text-xs px-2 py-1.5 outline-none focus:border-nc-accent-dim"
                min={0}
                max={2000}
              />
            </Field>
            <Field label="Device Count">
              <input
                type="text"
                value={`${metrics.devicesOnline} / ${devices.length}`}
                readOnly
                className="w-full bg-nc-bg border border-nc-line-strong text-nc-num font-mono text-xs px-2 py-1.5"
              />
            </Field>
            <Button
              variant="primary"
              onClick={handleDispatch}
              disabled={loading || activeDispatch?.status === 'executing'}
              hint={activeDispatch?.id ? `id=${activeDispatch.id.slice(0, 12)}` : undefined}
            >
              Start Dispatch
            </Button>
          </VerbBlock>

          <Divider />

          <VerbBlock title="Fault Injection">
            <Button variant="danger" onClick={handleMassOutage} hint="take offline · n=10">
              Mass Outage
            </Button>
            <Button variant="ok" onClick={handleRestoreAll} hint="rejoin + reallocate">
              Restore All
            </Button>
          </VerbBlock>

          <Divider />

          <VerbBlock title="Fleet">
            <Button variant="ghost" onClick={handleReset}>
              Reset Fleet
            </Button>
          </VerbBlock>
          
          <div className="mt-auto pt-4">
            <Link 
              href="/map" 
              className="block w-full text-left px-2.5 py-2 border border-nc-line-strong bg-nc-elev text-nc-ink text-xs font-medium hover:border-nc-ink-mute hover:bg-[#151820] transition-colors"
            >
              Texas Map View
              <span className="block text-[10px] text-nc-ink-mute font-mono mt-0.5">geographic visualization</span>
            </Link>
          </div>
        </aside>

        {/* Center - Metrics + Dispatch + Devices */}
        <main className="flex flex-col min-h-0 overflow-hidden">
          {/* Metrics Row */}
          <div className="grid grid-cols-6 border-b border-nc-line shrink-0">
            <MetricCell label="Total Capacity" value={Math.round(metrics.totalCapacityKw)} unit="kW" />
            <MetricCell label="Available" value={Math.round(metrics.availableCapacityKw)} unit="kW" />
            <MetricCell label="Reserve Blocked" value={Math.round(metrics.reserveBlockedKw)} unit="kW" />
            <MetricCell label="Online" value={metrics.devicesOnline} variant="online" />
            <MetricCell label="Offline" value={metrics.devicesOffline} variant="offline" />
            <MetricCell label="Target" value={Math.round(metrics.dispatchTargetKw)} unit="kW" last />
          </div>

          {/* Hour Slider */}
          {cachedErcotData?.hourlyData && cachedErcotData.hourlyData.length > 0 && selectedHourKey && cachedErcotData.currentHourKey && (
            <div className="border-b border-nc-line shrink-0 p-2">
              <HourSlider
                hourlyData={cachedErcotData.hourlyData}
                currentHourKey={cachedErcotData.currentHourKey}
                selectedHourKey={selectedHourKey}
                onHourChange={handleHourChange}
              />
            </div>
          )}

          {/* Dispatch Status + ERCOT Grid */}
          <div className="grid grid-cols-2 border-b border-nc-line shrink-0">
            <div className="p-3 border-r border-nc-line">
              <div className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-bold mb-2">Dispatch Status</div>
              <div className="flex items-baseline gap-3 mb-1.5">
                <span className="font-mono text-[22px] font-semibold text-nc-num tabular-nums">
                  {Math.round(metrics.deliveredKw)}<span className="text-nc-ink-mute font-normal"> / </span>{Math.round(metrics.dispatchTargetKw)}
                </span>
                <span className="font-mono text-sm text-nc-accent">{progressPct.toFixed(0)}%</span>
              </div>
              <div className="h-[3px] bg-nc-line-strong relative">
                <div 
                  className="absolute left-0 top-0 bottom-0 bg-nc-accent transition-all duration-300" 
                  style={{ width: `${Math.min(100, progressPct)}%` }} 
                />
              </div>
            </div>
            <div className="p-3 opacity-55">
              <div className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-bold mb-2">
                ERCOT Grid · Zone Alloc <span className="font-medium tracking-wider ml-1.5 opacity-70">
                  {cachedErcotData?.hourlyData?.find(h => h.hourKey === selectedHourKey)?.dataType === 'actual' ? 'ACTUAL' : 'FORECAST'}
                </span>
              </div>
              {/* ERCOT Data Source Badge */}
              <div className="mb-2">
                {cachedErcotData?.dataSource === 'live' ? (
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
              <ErcotMiniGrid ercotData={ercotData} cachedData={cachedErcotData} />
            </div>
          </div>

          {/* Arb Windows Price Strip */}
          <div className="border-b border-nc-line shrink-0 p-3 bg-[#0a0c0f]">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[9px] uppercase tracking-widest text-nc-ink-mute font-semibold">
                Wholesale SPP $/MWh · {priceData?.settlementPoint || 'HB_HUBAVG'}
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
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">Now</div>
                  <div className="font-mono text-lg font-semibold text-nc-num tabular-nums">
                    ${priceData?.currentPriceMwh?.toFixed(2) || '—'}
                    <span className="text-[10px] text-nc-ink-dim font-normal ml-0.5">/MWh</span>
                  </div>
                </div>
                <div>
                  <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                    Charge Window <span className="text-nc-ok">(buy low)</span>
                  </div>
                  {priceData?.arbEdge.chargeWindow ? (
                    <div className="font-mono text-sm text-nc-ink">
                      <span className="text-nc-ok font-semibold">${priceData.arbEdge.chargeWindow.priceMwh.toFixed(2)}</span>
                      <span className="text-nc-ink-dim text-[10px] ml-1">
                        @{priceData.arbEdge.chargeWindow.hourEnding}:00
                      </span>
                    </div>
                  ) : (
                    <div className="font-mono text-sm text-nc-ink-dim">—</div>
                  )}
                </div>
                <div>
                  <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                    Discharge Window <span className="text-nc-accent">(sell high)</span>
                  </div>
                  {priceData?.arbEdge.dischargeWindow ? (
                    <div className="font-mono text-sm text-nc-ink">
                      <span className="text-nc-accent font-semibold">${priceData.arbEdge.dischargeWindow.priceMwh.toFixed(2)}</span>
                      <span className="text-nc-ink-dim text-[10px] ml-1">
                        @{priceData.arbEdge.dischargeWindow.hourEnding}:00
                      </span>
                    </div>
                  ) : (
                    <div className="font-mono text-sm text-nc-ink-dim">—</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-nc-ink-dim text-[11px] font-mono">
                Price data unavailable — configure ERCOT credentials for live SPP
              </div>
            )}
            {priceData?.arbEdge && !priceData.arbEdge.hasEdge && priceData.currentPriceMwh !== null && (
              <div className="mt-2 text-[10px] font-mono text-nc-warn">
                No arb edge — spread below $5/MWh threshold
              </div>
            )}
            {priceData?.arbEdge?.hasEdge && (
              <div className="mt-2 text-[10px] font-mono text-nc-ok">
                ${priceData.arbEdge.spreadMwh.toFixed(2)}/MWh spread available
              </div>
            )}
          </div>

          {/* Devices Table */}
          <div className="flex-1 p-3 overflow-auto min-h-0">
            <div className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-bold mb-2">Fleet Devices · SOC / Avail</div>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="text-left text-[9px] tracking-wider uppercase text-nc-ink-mute font-bold pb-1.5 pr-2 border-b border-nc-line">Device</th>
                  <th className="text-left text-[9px] tracking-wider uppercase text-nc-ink-mute font-bold pb-1.5 pr-2 border-b border-nc-line">Zone</th>
                  <th className="text-left text-[9px] tracking-wider uppercase text-nc-ink-mute font-bold pb-1.5 pr-2 border-b border-nc-line">SOC</th>
                  <th className="text-left text-[9px] tracking-wider uppercase text-nc-ink-mute font-bold pb-1.5 pr-2 border-b border-nc-line">Avail</th>
                  <th className="text-left text-[9px] tracking-wider uppercase text-nc-ink-mute font-bold pb-1.5 pr-2 border-b border-nc-line">Status</th>
                  <th className="text-left text-[9px] tracking-wider uppercase text-nc-ink-mute font-bold pb-1.5 border-b border-nc-line">Action</th>
                </tr>
              </thead>
              <tbody>
                {devices.slice(0, 20).map((device) => {
                  const availablePower = Math.max(0, device.socPercent - device.reservePercent) / 100 * device.maxPowerKw;
                  return (
                    <tr key={device.id} className="hover:bg-[#12151a]">
                      <td className="py-1.5 pr-2 border-b border-nc-line font-mono text-[11px] text-nc-ink tabular-nums">{device.name}</td>
                      <td className="py-1.5 pr-2 border-b border-nc-line font-mono text-[11px] text-nc-ink">{device.zone}</td>
                      <td className="py-1.5 pr-2 border-b border-nc-line font-mono text-[11px] text-nc-ink tabular-nums">{device.socPercent.toFixed(0)}%</td>
                      <td className="py-1.5 pr-2 border-b border-nc-line font-mono text-[11px] text-nc-ink tabular-nums">{availablePower.toFixed(0)} kW</td>
                      <td className={`py-1.5 pr-2 border-b border-nc-line font-mono text-[11px] ${device.status === 'online' ? 'text-nc-ok' : 'text-nc-bad'}`}>
                        {device.status.toUpperCase()}
                      </td>
                      <td className="py-1.5 border-b border-nc-line">
                        {device.status === 'online' ? (
                          <button
                            onClick={() => handleInjectFault(device.id, 'offline')}
                            className="text-[10px] text-nc-ink-dim bg-transparent border border-nc-line px-1.5 py-0.5 hover:border-nc-ink-mute hover:text-nc-ink cursor-pointer"
                          >
                            offline
                          </button>
                        ) : (
                          <button
                            onClick={() => handleRestore(device.id)}
                            className="text-[10px] text-nc-ink-dim bg-transparent border border-nc-line px-1.5 py-0.5 hover:border-nc-ink-mute hover:text-nc-ink cursor-pointer"
                          >
                            restore
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </main>

        {/* Right Event Log */}
        <aside className="border-l border-nc-line-strong bg-[#08090b] flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-nc-line flex justify-between items-center shrink-0">
            <h3 className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-bold">Event Log</h3>
            <span className="font-mono text-[10px] text-nc-accent">● live</span>
          </div>
          <div className="flex-1 overflow-y-auto py-1.5 font-mono text-[11px] leading-relaxed">
            {events.slice().reverse().slice(0, 50).map((event) => (
              <div key={event.id} className="px-3 py-0.5 grid grid-cols-[64px_140px_1fr] gap-2 hover:bg-nc-panel">
                <span className="text-nc-ink-mute">
                  {new Date(event.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                </span>
                <span className={`font-semibold ${eventColors[event.type] || 'text-nc-ink-dim'}`}>
                  {event.type}
                </span>
                <span className="text-nc-ink-dim truncate">{formatEventMessage(event)}</span>
              </div>
            ))}
            {events.length === 0 && (
              <div className="text-nc-ink-mute text-center py-8">No events yet</div>
            )}
          </div>
        </aside>
      </div>

      {/* Footer - 28px */}
      <footer className="h-7 border-t border-nc-line-strong bg-[#08090b] flex items-center px-4 text-[10px] tracking-wider text-nc-ink-mute font-mono uppercase shrink-0">
        <strong className="text-nc-warn font-semibold mr-2">SYNTHETIC DISCLAIMER</strong>
        Simulated ERCOT / fleet telemetry for hackathon demo only. Not connected to live grid or production devices.
      </footer>
    </div>
  );
}

function ProofCell({ label, value, accent, warn, last }: { 
  label: string; 
  value: number; 
  accent?: boolean; 
  warn?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`px-3.5 py-1.5 flex flex-col justify-center gap-0.5 ${!last ? 'border-r border-nc-line' : ''}`}>
      <span className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-semibold">{label}</span>
      <span className={`font-mono text-lg font-semibold tabular-nums ${
        accent ? 'text-nc-accent' : warn ? 'text-nc-warn' : 'text-nc-num'
      }`}>{value}</span>
    </div>
  );
}

function MetricCell({ label, value, unit, variant, last }: {
  label: string;
  value: number;
  unit?: string;
  variant?: 'online' | 'offline';
  last?: boolean;
}) {
  return (
    <div className={`p-3 ${!last ? 'border-r border-nc-line' : ''}`}>
      <div className="text-[9px] tracking-wider uppercase text-nc-ink-mute mb-0.5">{label}</div>
      <div className={`font-mono text-[15px] font-semibold tabular-nums ${
        variant === 'online' ? 'text-nc-ok' : variant === 'offline' ? 'text-nc-bad' : 'text-nc-num'
      }`}>
        {value}
        {unit && <span className="text-[10px] text-nc-ink-dim font-normal ml-0.5">{unit}</span>}
      </div>
    </div>
  );
}

function VerbBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-bold mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <label className="block text-[10px] text-nc-ink-dim mb-0.5">{label}</label>
      {children}
    </div>
  );
}

function Button({ 
  children, 
  variant = 'default', 
  onClick, 
  disabled,
  hint 
}: { 
  children: React.ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'ok' | 'ghost';
  onClick?: () => void;
  disabled?: boolean;
  hint?: string;
}) {
  const variantStyles = {
    default: 'border-nc-line-strong text-nc-ink bg-nc-elev hover:border-nc-ink-mute hover:bg-[#151820]',
    primary: 'border-nc-accent-dim text-nc-accent bg-[#161208] hover:bg-[#1e180a]',
    danger: 'border-[#5a2828] text-[#e07070] hover:bg-[#1a1010]',
    ok: 'border-[#1e4a32] text-nc-ok hover:bg-[#0a1810]',
    ghost: 'border-nc-line-strong border-dashed text-nc-ink-dim hover:text-nc-ink',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`block w-full text-left px-2.5 py-2 border text-xs font-medium cursor-pointer transition-colors ${variantStyles[variant]} ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      }`}
    >
      {children}
      {hint && <span className="block text-[10px] font-normal text-nc-ink-mute font-mono mt-0.5">{hint}</span>}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-nc-line my-1" />;
}

function ErcotMiniGrid({ ercotData, cachedData }: { ercotData: ErcotData | null; cachedData: ErcotCacheData | null }) {
  if (cachedData?.gridSummary) {
    const { gridSummary } = cachedData;
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-nc-ink-dim">
        <div>P1 load <strong className="text-nc-ink font-medium">{(gridSummary.totalLoadMw / 1000).toFixed(2)} GW</strong></div>
        <div>freq <strong className="text-nc-ink font-medium">{gridSummary.frequencyHz.toFixed(2)} Hz</strong></div>
        <div>North <strong className="text-nc-ink font-medium">{Math.round(gridSummary.totalLoadMw * 0.35 / 10)} kW</strong></div>
        <div>South <strong className="text-nc-ink font-medium">{Math.round(gridSummary.totalLoadMw * 0.28 / 10)} kW</strong></div>
        <div>West <strong className="text-nc-ink font-medium">{Math.round(gridSummary.totalLoadMw * 0.19 / 10)} kW</strong></div>
        <div>Houston <strong className="text-nc-ink font-medium">{Math.round(gridSummary.totalLoadMw * 0.18 / 10)} kW</strong></div>
      </div>
    );
  }

  if (ercotData?.gridStatus) {
    const { gridStatus } = ercotData;
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-nc-ink-dim">
        <div>P1 load <strong className="text-nc-ink font-medium">{(gridStatus.totalLoadMw / 1000).toFixed(2)} GW</strong></div>
        <div>freq <strong className="text-nc-ink font-medium">59.97 Hz</strong></div>
        <div>North <strong className="text-nc-ink font-medium">118 kW</strong></div>
        <div>South <strong className="text-nc-ink font-medium">94 kW</strong></div>
        <div>West <strong className="text-nc-ink font-medium">62 kW</strong></div>
        <div>Houston <strong className="text-nc-ink font-medium">38 kW</strong></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-nc-ink-dim">
      <div>P1 load <strong className="text-nc-ink font-medium">1.42 GW</strong></div>
      <div>freq <strong className="text-nc-ink font-medium">59.97 Hz</strong></div>
      <div>North <strong className="text-nc-ink font-medium">118 kW</strong></div>
      <div>South <strong className="text-nc-ink font-medium">94 kW</strong></div>
      <div>West <strong className="text-nc-ink font-medium">62 kW</strong></div>
      <div>Houston <strong className="text-nc-ink font-medium">38 kW</strong></div>
    </div>
  );
}
