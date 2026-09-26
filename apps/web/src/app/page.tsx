'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Device, FleetMetrics, FleetEvent, Dispatch, Command, ErcotZone, GridStatus, ZoneAllocation } from '@fleetfail/engine';

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

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: 'bg-green-500',
    offline: 'bg-red-500',
    reconnecting: 'bg-yellow-500',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || 'bg-gray-500'}`} />
  );
}

function MetricCard({ label, value, unit, color }: { label: string; value: number | string; unit?: string; color?: string }) {
  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="text-slate-400 text-sm">{label}</div>
      <div className={`text-2xl font-mono font-bold ${color || 'text-white'}`}>
        {typeof value === 'number' ? value.toFixed(1) : value}
        {unit && <span className="text-sm text-slate-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function DeviceCard({ device, onInjectFault, onRestore }: { 
  device: Device; 
  onInjectFault: (deviceId: string, faultType: string) => void;
  onRestore: (deviceId: string) => void;
}) {
  const availablePower = Math.max(0, device.socPercent - device.reservePercent) / 100 * device.maxPowerKw;
  
  return (
    <div className={`p-2 rounded border ${
      device.status === 'online' ? 'border-green-700 bg-green-950/30' : 
      device.status === 'offline' ? 'border-red-700 bg-red-950/30' : 
      'border-yellow-700 bg-yellow-950/30'
    }`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-mono truncate" title={device.name}>{device.name}</span>
        <StatusBadge status={device.status} />
      </div>
      <div className="text-xs text-slate-400">
        <div className="flex justify-between">
          <span>SOC</span>
          <span>{device.socPercent.toFixed(0)}%</span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
          <div 
            className={`h-1.5 rounded-full ${device.socPercent > 50 ? 'bg-green-500' : device.socPercent > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${device.socPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span>Avail</span>
          <span>{availablePower.toFixed(1)} kW</span>
        </div>
      </div>
      <div className="flex gap-1 mt-2">
        {device.status === 'online' ? (
          <button 
            onClick={() => onInjectFault(device.id, 'offline')}
            className="flex-1 text-xs px-1 py-0.5 bg-red-800 hover:bg-red-700 rounded"
          >
            Take Offline
          </button>
        ) : (
          <button 
            onClick={() => onRestore(device.id)}
            className="flex-1 text-xs px-1 py-0.5 bg-green-800 hover:bg-green-700 rounded"
          >
            Restore
          </button>
        )}
      </div>
    </div>
  );
}

function EventLog({ events }: { events: FleetEvent[] }) {
  const eventColors: Record<string, string> = {
    COMMAND_SENT: 'text-blue-400',
    COMMAND_ACKED: 'text-green-400',
    ACK_TIMEOUT: 'text-yellow-400',
    RETRY_SAME_ID: 'text-yellow-300',
    DUPLICATE_IGNORED: 'text-purple-400',
    STALE_REJECTED: 'text-orange-400',
    DEVICE_EXCLUDED: 'text-gray-400',
    REALLOCATED: 'text-cyan-400',
    DEVICE_OFFLINE: 'text-red-400',
    DEVICE_ONLINE: 'text-green-300',
    DEVICE_RECONNECTED: 'text-green-500',
    DISPATCH_STARTED: 'text-blue-300',
    DISPATCH_CONVERGED: 'text-green-500',
    DISPATCH_PARTIAL: 'text-yellow-500',
    DISPATCH_INSUFFICIENT: 'text-red-500',
    COMMAND_EXPIRED: 'text-gray-500',
  };

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-700 h-64 overflow-hidden">
      <div className="px-3 py-2 border-b border-slate-700 text-sm font-semibold">Event Log</div>
      <div className="overflow-y-auto h-52 p-2 space-y-1 font-mono text-xs">
        {events.slice().reverse().map((event) => (
          <div key={event.id} className="flex gap-2">
            <span className="text-slate-500 w-20 shrink-0">
              {new Date(event.timestamp).toLocaleTimeString()}
            </span>
            <span className={eventColors[event.type] || 'text-slate-300'}>
              {event.type}
            </span>
            {event.deviceId && (
              <span className="text-slate-500">
                [{event.deviceId.slice(0, 8)}]
              </span>
            )}
            {event.details && Object.keys(event.details).length > 0 && (
              <span className="text-slate-600">
                {JSON.stringify(event.details)}
              </span>
            )}
          </div>
        ))}
        {events.length === 0 && (
          <div className="text-slate-500 text-center py-8">No events yet</div>
        )}
      </div>
    </div>
  );
}

function ErcotBanner({ data }: { data: ErcotData | null }) {
  if (!data) return null;
  
  const { gridStatus } = data;
  
  return (
    <div className="bg-gradient-to-r from-blue-900 to-purple-900 rounded-lg p-4 border border-blue-700">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-blue-300 uppercase tracking-wide">ERCOT Grid Status (Synthetic)</div>
          <div className="text-lg font-bold text-white">
            {(gridStatus.totalLoadMw / 1000).toFixed(1)} GW Total Load
          </div>
        </div>
        <div className="flex gap-6">
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-green-400">
              {gridStatus.renewablePercent.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-400">Renewables</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-yellow-400">
              {gridStatus.avgTemperatureF.toFixed(0)}°F
            </div>
            <div className="text-xs text-slate-400">Avg Temp</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-mono font-bold text-cyan-400">
              {(gridStatus.renewablesMw / 1000).toFixed(1)} GW
            </div>
            <div className="text-xs text-slate-400">Wind + Solar</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoneMap({ data, events }: { data: ErcotData | null; events: FleetEvent[] }) {
  if (!data) return null;
  
  const { zoneAllocations } = data;
  
  const recentEventsByZone = new Map<string, number>();
  for (const event of events.slice(-50)) {
    if (event.deviceId) {
      const allocation = zoneAllocations.find(za => 
        za.devices.some(d => d.id === event.deviceId)
      );
      if (allocation) {
        const count = recentEventsByZone.get(allocation.zone.id) ?? 0;
        recentEventsByZone.set(allocation.zone.id, count + 1);
      }
    }
  }
  
  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700 p-4">
      <h2 className="font-semibold mb-3">Zone Allocation (Synthetic)</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {zoneAllocations.map(za => {
          const eventActivity = recentEventsByZone.get(za.zone.id) ?? 0;
          const activityLevel = eventActivity > 10 ? 'high' : eventActivity > 3 ? 'medium' : 'low';
          
          return (
            <div 
              key={za.zone.id}
              className={`p-2 rounded border ${
                activityLevel === 'high' ? 'border-red-500 bg-red-950/30' :
                activityLevel === 'medium' ? 'border-yellow-500 bg-yellow-950/30' :
                'border-slate-600 bg-slate-900/30'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold">{za.zone.name}</span>
                {activityLevel !== 'low' && (
                  <span className={`w-2 h-2 rounded-full ${
                    activityLevel === 'high' ? 'bg-red-500 animate-pulse' : 'bg-yellow-500'
                  }`} />
                )}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                <div className="flex justify-between">
                  <span>Devices</span>
                  <span>{za.onlineCount}/{za.devices.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Available</span>
                  <span className="text-green-400">{za.availableCapacityKw.toFixed(1)} kW</span>
                </div>
                <div className="flex justify-between">
                  <span>Zone Load</span>
                  <span className="text-blue-400">{(za.zone.netLoadMw / 1000).toFixed(1)} GW</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DispatchStatus({ dispatch }: { dispatch: Dispatch | null }) {
  if (!dispatch) {
    return (
      <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
        <div className="text-slate-400 text-sm">No Active Dispatch</div>
        <div className="text-slate-500 text-xs mt-1">Start a dispatch to see status</div>
      </div>
    );
  }

  const progressPct = dispatch.targetKw > 0 ? (dispatch.deliveredKw / dispatch.targetKw) * 100 : 0;
  const statusColors: Record<string, string> = {
    allocating: 'text-blue-400',
    executing: 'text-yellow-400',
    converged: 'text-green-400',
    partial: 'text-orange-400',
    insufficient_capacity: 'text-red-400',
    failed: 'text-red-500',
  };

  return (
    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
      <div className="flex justify-between items-center mb-2">
        <span className="text-slate-400 text-sm">Dispatch Status</span>
        <span className={`text-sm font-semibold ${statusColors[dispatch.status]}`}>
          {dispatch.status.toUpperCase().replace('_', ' ')}
        </span>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>Target</span>
          <span className="font-mono">{dispatch.targetKw.toFixed(1)} kW</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Delivered</span>
          <span className="font-mono text-green-400">{dispatch.deliveredKw.toFixed(1)} kW</span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-3 mt-2">
          <div 
            className={`h-3 rounded-full transition-all duration-300 ${
              progressPct >= 99 ? 'bg-green-500' : progressPct >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
            }`}
            style={{ width: `${Math.min(100, progressPct)}%` }}
          />
        </div>
        <div className="text-right text-xs text-slate-500">
          {progressPct.toFixed(1)}% complete
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [ercotData, setErcotData] = useState<ErcotData | null>(null);
  const [targetKw, setTargetKw] = useState(400);
  const [loading, setLoading] = useState(false);
  const [deviceCount, setDeviceCount] = useState(50);

  const fetchState = useCallback(async () => {
    try {
      const [stateRes, ercotRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/ercot'),
      ]);
      const [stateData, ercotDataRes] = await Promise.all([
        stateRes.json(),
        ercotRes.json(),
      ]);
      setState(stateData);
      setErcotData(ercotDataRes);
    } catch (error) {
      console.error('Failed to fetch state:', error);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 500);
    return () => clearInterval(interval);
  }, [fetchState]);

  const handleDispatch = async () => {
    setLoading(true);
    try {
      await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKw }),
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl">Loading FleetFail Simulator...</div>
      </div>
    );
  }

  const { metrics, devices, events, activeDispatch, isRunning } = state;

  return (
    <main className="min-h-screen p-4 lg:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">
              FleetFail <span className="text-green-400">⚡</span>
            </h1>
            <p className="text-slate-400 text-sm">
              Resilient Dispatch Simulator — Proving idempotent at-least-once delivery
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
              isRunning ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'
            }`}>
              {isRunning ? '● RUNNING' : '○ IDLE'}
            </div>
          </div>
        </header>

        {/* ERCOT Banner */}
        <ErcotBanner data={ercotData} />

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <MetricCard label="Total Capacity" value={metrics.totalCapacityKw} unit="kW" />
          <MetricCard label="Available" value={metrics.availableCapacityKw} unit="kW" color="text-green-400" />
          <MetricCard label="Reserve Blocked" value={metrics.reserveBlockedKw} unit="kW" color="text-yellow-400" />
          <MetricCard label="Online" value={metrics.devicesOnline} color="text-green-400" />
          <MetricCard label="Offline" value={metrics.devicesOffline} color="text-red-400" />
          <MetricCard label="Target" value={metrics.dispatchTargetKw} unit="kW" color="text-blue-400" />
        </div>

        {/* Invariant Counters */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard label="Delivered" value={metrics.deliveredKw} unit="kW" color="text-green-400" />
          <MetricCard label="Pending Cmds" value={metrics.pendingCommands} color="text-yellow-400" />
          <MetricCard label="Duplicates Ignored" value={metrics.duplicatesIgnored} color="text-purple-400" />
          <MetricCard label="Stale Rejected" value={metrics.staleRejected} color="text-orange-400" />
          <MetricCard label="Reallocations" value={metrics.reallocations} color="text-cyan-400" />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Controls */}
          <div className="space-y-4">
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
              <h2 className="font-semibold">Dispatch Control</h2>
              <div>
                <label className="text-sm text-slate-400">Target Power (kW)</label>
                <input
                  type="number"
                  value={targetKw}
                  onChange={(e) => setTargetKw(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                  min={0}
                  max={1000}
                />
              </div>
              <button
                onClick={handleDispatch}
                disabled={loading || (activeDispatch?.status === 'executing')}
                className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 rounded font-semibold transition-colors"
              >
                Start Dispatch
              </button>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
              <h2 className="font-semibold">Fault Injection</h2>
              <button
                onClick={handleMassOutage}
                className="w-full py-2 bg-red-800 hover:bg-red-700 rounded font-semibold"
              >
                Inject Mass Outage (10 devices)
              </button>
              <button
                onClick={handleRestoreAll}
                className="w-full py-2 bg-green-800 hover:bg-green-700 rounded font-semibold"
              >
                Restore All Devices
              </button>
            </div>

            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700 space-y-4">
              <h2 className="font-semibold">Fleet Reset</h2>
              <div>
                <label className="text-sm text-slate-400">Device Count</label>
                <select
                  value={deviceCount}
                  onChange={(e) => setDeviceCount(Number(e.target.value))}
                  className="w-full mt-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-white"
                >
                  <option value={50}>50 devices</option>
                  <option value={100}>100 devices</option>
                </select>
              </div>
              <button
                onClick={handleReset}
                className="w-full py-2 bg-slate-700 hover:bg-slate-600 rounded font-semibold"
              >
                Reset Fleet
              </button>
            </div>

            <DispatchStatus dispatch={activeDispatch} />
          </div>

          {/* Device Grid */}
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700 flex justify-between items-center">
                <h2 className="font-semibold">Fleet Devices</h2>
                <span className="text-sm text-slate-400">{devices.length} total</span>
              </div>
              <div className="p-3 grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-96 overflow-y-auto">
                {devices.map((device) => (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onInjectFault={handleInjectFault}
                    onRestore={handleRestore}
                  />
                ))}
              </div>
            </div>

            <EventLog events={events} />
            
            <ZoneMap data={ercotData} events={events} />
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-xs text-slate-600 py-4 border-t border-slate-800">
          <p className="font-semibold text-slate-500">⚠️ SYNTHETIC DISCLAIMER</p>
          <p>This is NOT Base proprietary architecture. All datasets, telemetry, and demo figures are synthetic unless a file explicitly states otherwise.</p>
          <p className="mt-2">Base Power × AITX Hackathon — Orchestration + Open Grid Data Tracks</p>
        </footer>
      </div>
    </main>
  );
}
