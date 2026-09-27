'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import type { Device, FleetMetrics, FleetEvent, Dispatch, Command, ErcotZone, GridStatus, ZoneAllocation, ErcotCacheData, PriceCacheData } from '@fleetfail/engine';
import { findPriceForHourKey, findArbWindowsForHourKey } from '@fleetfail/engine/ercot-prices';
import { HourSlider } from '@/components/HourSlider';

const PRICE_REFRESH_MS = 15 * 60 * 1000; // 15 minutes - aligned with RT SPP TTL
const AUTO_DISPATCH_TARGET_KW = 1500;

interface ErcotData {
  zones: ErcotZone[];
  zoneAllocations: ZoneAllocation[];
  gridStatus: GridStatus;
}

interface ArbModeState {
  armed: boolean;
  chargeWindow: { hourEnding: number; priceMwh: number } | null;
  dischargeWindow: { hourEnding: number; priceMwh: number } | null;
  spreadMwh: number;
  armedAt: number | null;
}

interface SimulationState {
  devices: Device[];
  metrics: FleetMetrics;
  events: FleetEvent[];
  commands: Command[];
  activeDispatch: Dispatch | null;
  isRunning: boolean;
  currentTime: number;
  arbMode?: ArbModeState;
}

export default function Home() {
  const [state, setState] = useState<SimulationState | null>(null);
  const [ercotData, setErcotData] = useState<ErcotData | null>(null);
  const [cachedErcotData, setCachedErcotData] = useState<ErcotCacheData | null>(null);
  const [priceData, setPriceData] = useState<PriceCacheData | null>(null);
  const [targetKw, setTargetKw] = useState(1500);
  const [loading, setLoading] = useState(false);
  const [deviceCount, setDeviceCount] = useState(50);
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);
  
  const selectedHourKeyRef = useRef<string | null>(null);
  selectedHourKeyRef.current = selectedHourKey;
  
  const lastStateFingerprintRef = useRef<string>('');
  const lastErcotCacheFingerprintRef = useRef<string>('');
  const lastPriceFingerprintRef = useRef<string>('');
  
  // Auto-fire state: tracks which discharge window hours have been auto-fired (client-only, resets on reload)
  const autoFiredWindowsRef = useRef<Set<number>>(new Set());
  const [autoFireFired, setAutoFireFired] = useState(false);
  
  // Ref to hold the dispatch handler for use in effects (avoids stale closure)
  const startDispatchRef = useRef<(overrideTargetKw?: number) => Promise<void>>();

  const fetchState = useCallback(async () => {
    try {
      const currentHourKey = selectedHourKeyRef.current;
      const hourParam = currentHourKey ? `?hourKey=${encodeURIComponent(currentHourKey)}` : '';
      const [stateRes, cachedErcotRes] = await Promise.all([
        fetch('/api/state'),
        fetch(`/api/ercot-cache${hourParam}`),
      ]);
      const [stateData, cachedErcotDataRes] = await Promise.all([
        stateRes.json(),
        cachedErcotRes.json(),
      ]);
      
      const stateFingerprint = JSON.stringify({
        deliveredKw: stateData.metrics?.deliveredKw,
        pendingCommands: stateData.metrics?.pendingCommands,
        devicesOnline: stateData.metrics?.devicesOnline,
        devicesOffline: stateData.metrics?.devicesOffline,
        dispatchTargetKw: stateData.metrics?.dispatchTargetKw,
        isRunning: stateData.isRunning,
        dispatchStatus: stateData.activeDispatch?.status,
        dispatchId: stateData.activeDispatch?.id,
        eventsLen: stateData.events?.length,
        lastEventId: stateData.events?.[stateData.events.length - 1]?.id,
        arbArmed: stateData.arbMode?.armed,
      });
      if (stateFingerprint !== lastStateFingerprintRef.current) {
        lastStateFingerprintRef.current = stateFingerprint;
        setState(stateData);
      }
      
      const ercotFingerprint = JSON.stringify({
        dataSource: cachedErcotDataRes.dataSource,
        currentHourKey: cachedErcotDataRes.currentHourKey,
        totalLoadMw: cachedErcotDataRes.gridSummary?.totalLoadMw,
        frequencyHz: cachedErcotDataRes.gridSummary?.frequencyHz,
        hourlyDataLen: cachedErcotDataRes.hourlyData?.length,
      });
      if (ercotFingerprint !== lastErcotCacheFingerprintRef.current) {
        lastErcotCacheFingerprintRef.current = ercotFingerprint;
        setCachedErcotData(cachedErcotDataRes);
      }
      
      if (!selectedHourKeyRef.current && cachedErcotDataRes.currentHourKey) {
        setSelectedHourKey(cachedErcotDataRes.currentHourKey);
      }
    } catch (error) {
      console.error('Failed to fetch state:', error);
    }
  }, []);
  
  const lastErcotFingerprintRef = useRef<string>('');
  
  const fetchErcotData = useCallback(async () => {
    try {
      const res = await fetch('/api/ercot');
      const data = await res.json();
      const fingerprint = JSON.stringify({
        totalLoadMw: data.gridStatus?.totalLoadMw,
        zonesLen: data.zones?.length,
      });
      if (fingerprint !== lastErcotFingerprintRef.current) {
        lastErcotFingerprintRef.current = fingerprint;
        setErcotData(data);
      }
    } catch (error) {
      console.error('Failed to fetch ERCOT data:', error);
    }
  }, []);
  
  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch('/api/ercot-prices');
      const data: PriceCacheData = await res.json();
      
      const fingerprint = JSON.stringify({
        currentPriceMwh: data.currentPriceMwh,
        settlementPoint: data.settlementPoint,
        dataSource: data.dataSource,
        chargeWindow: data.arbEdge?.chargeWindow,
        dischargeWindow: data.arbEdge?.dischargeWindow,
      });
      
      if (fingerprint !== lastPriceFingerprintRef.current) {
        // Don't overwrite good LIVE/Cached data with Unavailable
        // Sticky last-good: keep previous prices on transient failures
        const isUnavailable = data.currentPriceMwh === null;
        const hadGoodData = lastPriceFingerprintRef.current !== '' && 
          !lastPriceFingerprintRef.current.includes('"currentPriceMwh":null');
        
        if (isUnavailable && hadGoodData) {
          return;
        }
        
        lastPriceFingerprintRef.current = fingerprint;
        setPriceData(data);
      }
    } catch (error) {
      console.error('Failed to fetch price data:', error);
    }
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 500);
    return () => clearInterval(interval);
  }, [fetchState]);
  
  useEffect(() => {
    fetchErcotData();
  }, [fetchErcotData]);
  
  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, PRICE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchPrices]);
  
  // Auto-dispatch effect: fires Start Dispatch when wall clock reaches armed discharge window
  useEffect(() => {
    const checkAutoFire = () => {
      const arbMode = state?.arbMode;
      const activeDispatch = state?.activeDispatch;
      
      // Conditions to skip auto-fire:
      // 1. Not armed
      if (!arbMode?.armed) return;
      
      // 2. No discharge window
      const dischargeWindow = arbMode.dischargeWindow;
      if (!dischargeWindow) return;
      
      // 3. Already fired for this window
      const windowHour = dischargeWindow.hourEnding;
      if (autoFiredWindowsRef.current.has(windowHour)) return;
      
      // 4. Dispatch already active (allocating or executing)
      if (activeDispatch?.status === 'allocating' || activeDispatch?.status === 'executing') return;
      
      // Check if wall clock hour matches discharge window
      // ERCOT hour-ending: hourEnding 17 = 16:00-17:00, so we fire when current hour >= hourEnding - 1
      const now = new Date();
      const currentHour = now.getHours();
      
      // Fire when we're in the discharge window hour
      // hourEnding 17 means the hour 16:00-17:00, so fire when currentHour === 16
      // Or for demo flexibility: fire when currentHour === targetHour or windowHour
      const targetHour = windowHour - 1; // Convert hour-ending to hour-starting
      
      if (currentHour === targetHour || currentHour === windowHour) {
        // Fire auto-dispatch
        autoFiredWindowsRef.current.add(windowHour);
        setAutoFireFired(true);
        startDispatchRef.current?.(AUTO_DISPATCH_TARGET_KW);
      }
    };
    
    // Check immediately and then every second
    checkAutoFire();
    const interval = setInterval(checkAutoFire, 1000);
    return () => clearInterval(interval);
  }, [state?.arbMode, state?.activeDispatch]);
  
  // Reset auto-fire flag when arb mode is disarmed
  useEffect(() => {
    if (!state?.arbMode?.armed) {
      setAutoFireFired(false);
    }
  }, [state?.arbMode?.armed]);
  
  // Compute auto-fire status for UI (simple version for home page)
  const autoFireStatus = useMemo(() => {
    const arbMode = state?.arbMode;
    if (!arbMode?.armed) return null;
    
    const dischargeWindow = arbMode.dischargeWindow;
    if (!dischargeWindow) return null;
    
    const windowHour = dischargeWindow.hourEnding;
    const hasFired = autoFiredWindowsRef.current.has(windowHour) || autoFireFired;
    
    return {
      fired: hasFired,
      scheduledHour: windowHour - 1,
    };
  }, [state?.arbMode, autoFireFired]);
  
  const handleHourChange = useCallback((hourKey: string) => {
    setSelectedHourKey(hourKey);
  }, []);

  const handleDispatch = async (overrideTargetKw?: number) => {
    setLoading(true);
    try {
      await fetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetKw: overrideTargetKw ?? targetKw, selectedHourKey }),
      });
      await fetchState();
    } finally {
      setLoading(false);
    }
  };
  
  // Keep the ref updated so the auto-fire effect can use it
  startDispatchRef.current = handleDispatch;

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
    const count = Math.min(100, onlineDevices.length);
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


  // Device name map - must be before early return to satisfy hooks rules
  const deviceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const devices = state?.devices ?? [];
    for (const d of devices) {
      map.set(d.id, d.name);
    }
    return map;
  }, [state?.devices]);

  const deviceIdToName = (deviceId: string | null): string => {
    if (!deviceId) return '';
    return deviceNameMap.get(deviceId) ?? deviceId;
  };

  if (!state) {
    return (
      <div className="h-screen flex items-center justify-center bg-nc-bg">
        <div className="text-nc-ink-dim">Loading FleetFail Simulator...</div>
      </div>
    );
  }

  const { 
    metrics = {} as FleetMetrics, 
    devices = [], 
    events = [], 
    activeDispatch, 
    isRunning 
  } = state;
  const progressPct = (metrics?.dispatchTargetKw ?? 0) > 0 
    ? ((metrics?.deliveredKw ?? 0) / metrics.dispatchTargetKw) * 100 
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
    ARB_ARMED: 'text-nc-accent',
    ARB_DISARMED: 'text-nc-ink-mute',
    ARB_CHARGE_WINDOW: 'text-nc-ok',
    ARB_DISCHARGE_WINDOW: 'text-nc-accent',
  };


  const formatEventMessage = (event: FleetEvent): string => {
    const details = event.details as Record<string, unknown> | undefined;
    if (event.type === 'COMMAND_SENT') {
      return `target=${metrics?.dispatchTargetKw ?? 0}kW ${event.commandId ? `id=${event.commandId.slice(0, 12)}` : ''}`;
    }
    if (event.type === 'DEVICE_OFFLINE' || event.type === 'DEVICE_RECONNECTED') {
      return event.deviceId ? `${deviceIdToName(event.deviceId)} ${details?.zone || ''}` : '';
    }
    if (event.type === 'REALLOCATED') {
      const kw = details?.reallocatedKw;
      return kw ? `${kw}kW redistributed` : 'power redistributed';
    }
    if (event.type === 'STALE_REJECTED') {
      return event.deviceId ? deviceIdToName(event.deviceId) : '';
    }
    if (event.type === 'ARB_ARMED') {
      const spread = details?.spreadMwh as number | undefined;
      const chargeHr = details?.chargeWindowHour as number | undefined;
      const dischargeHr = details?.dischargeWindowHour as number | undefined;
      return `$${spread?.toFixed(2) ?? '—'}/MWh · charge@${chargeHr ?? '—'}:00 → discharge@${dischargeHr ?? '—'}:00`;
    }
    if (event.type === 'ARB_DISARMED') {
      return 'arb mode disarmed';
    }
    if (event.type === 'ARB_CHARGE_WINDOW') {
      const kw = details?.targetKw as number | undefined;
      const price = details?.priceMwh as number | undefined;
      const hr = details?.hourEnding as number | undefined;
      return `${kw ?? '—'}kW @$${price?.toFixed(2) ?? '—'}/MWh (hr ${hr ?? '—'})`;
    }
    if (event.type === 'ARB_DISCHARGE_WINDOW') {
      const kw = details?.targetKw as number | undefined;
      const price = details?.priceMwh as number | undefined;
      const hr = details?.hourEnding as number | undefined;
      return `${kw ?? '—'}kW @$${price?.toFixed(2) ?? '—'}/MWh (hr ${hr ?? '—'})`;
    }
    if (event.deviceId) {
      return deviceIdToName(event.deviceId);
    }
    return '';
  };

  const hourPrice = findPriceForHourKey(priceData, selectedHourKey);
  // Display-only: charge/discharge track selectedHourKey. Arm still uses wall-clock arbEdge.
  const displayArb = findArbWindowsForHourKey(priceData, selectedHourKey);
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

      {/* Proof Strip - 48px for full digit visibility */}
      <div className="h-12 grid grid-cols-5 border-b border-nc-line-strong bg-[#0c0e12] shrink-0 relative z-10">
        <ProofCell label="Delivered" value={Math.round(metrics?.deliveredKw ?? 0)} accent />
        <ProofCell label="Pending Cmds" value={metrics?.pendingCommands ?? 0} />
        <ProofCell label="Duplicates Ignored" value={metrics?.duplicatesIgnored ?? 0} />
        <ProofCell label="Stale Rejected" value={metrics?.staleRejected ?? 0} warn={(metrics?.staleRejected ?? 0) > 0} />
        <ProofCell label="Reallocations" value={metrics?.reallocations ?? 0} accent last />
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
              onClick={() => handleDispatch()}
              disabled={loading || activeDispatch?.status === 'executing'}
              hint={activeDispatch?.id ? `id=${activeDispatch.id.slice(0, 12)}` : undefined}
            >
              Start Dispatch
            </Button>
            {/* Auto-dispatch status when armed (client demo automation) */}
            {state?.arbMode?.armed && autoFireStatus && (
              <div className={`mt-2 px-2 py-1.5 text-[10px] font-mono border ${
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
                ) : null}
              </div>
            )}
          </VerbBlock>

          <Divider />

          <VerbBlock title="Fault Injection">
            <Button variant="danger" onClick={handleMassOutage} hint="take offline · n=100">
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
              <ErcotMiniGrid ercotData={ercotData} cachedData={cachedErcotData} selectedHourKey={selectedHourKey} />
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
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                  Selected hour
                  {hourPrice ? (
                    <span className="ml-1 text-nc-ink-dim normal-case tracking-normal">
                      ({hourPrice.source === 'dam' ? 'DAM' : 'RT'})
                    </span>
                  ) : null}
                </div>
                <div className="font-mono text-lg font-semibold text-nc-num tabular-nums">
                  {hourPrice ? (
                    <>${hourPrice.priceMwh.toFixed(2)}<span className="text-[10px] text-nc-ink-dim font-normal ml-0.5">/MWh</span></>
                  ) : (
                    <span className="text-nc-ink-dim text-sm font-normal">No price for hour</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                  Charge Window <span className="text-nc-ok">(buy low)</span>
                </div>
                {displayArb.chargeWindow ? (
                  <div className="font-mono text-sm text-nc-ink">
                    <span className="text-nc-ok font-semibold">${displayArb.chargeWindow.priceMwh.toFixed(2)}</span>
                    <span className="text-nc-ink-dim text-[10px] ml-1">
                      @{displayArb.chargeWindow.hourEnding}:00
                    </span>
                  </div>
                ) : (
                  <div className="font-mono text-sm text-nc-ink-dim">Unavailable</div>
                )}
              </div>
              <div>
                <div className="text-[9px] text-nc-ink-mute uppercase tracking-wider mb-0.5">
                  Discharge Window <span className="text-nc-accent">(sell high)</span>
                </div>
                {displayArb.dischargeWindow ? (
                  <div className="font-mono text-sm text-nc-ink">
                    <span className="text-nc-accent font-semibold">${displayArb.dischargeWindow.priceMwh.toFixed(2)}</span>
                    <span className="text-nc-ink-dim text-[10px] ml-1">
                      @{displayArb.dischargeWindow.hourEnding}:00
                    </span>
                  </div>
                ) : (
                  <div className="font-mono text-sm text-nc-ink-dim">Unavailable</div>
                )}
              </div>
            </div>
            {displayArb.chargeWindow && !displayArb.hasEdge && (
              <div className="mt-2 text-[10px] font-mono text-nc-warn">
                No arb edge — spread below $5/MWh threshold
              </div>
            )}
            {displayArb.hasEdge && (
              <div className="mt-2 text-[10px] font-mono text-nc-ok">
                ${displayArb.spreadMwh.toFixed(2)}/MWh spread available
              </div>
            )}
            {priceData?.currentPriceMwh === null && (
              <div className="mt-2 text-[10px] font-mono text-nc-ink-dim">
                Price data unavailable
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

function ErcotMiniGrid({
  ercotData,
  cachedData,
  selectedHourKey,
}: {
  ercotData: ErcotData | null;
  cachedData: ErcotCacheData | null;
  selectedHourKey?: string | null;
}) {
  // Prefer selected-hour snapshot so Load/Wind/Solar/Net track the slider.
  const hourSummary =
    (selectedHourKey && cachedData?.hourlyData?.find(h => h.hourKey === selectedHourKey)?.gridSummary)
    || cachedData?.gridSummary
    || null;

  if (hourSummary) {
    const hasRenewables =
      typeof hourSummary.totalWindMw === 'number' &&
      typeof hourSummary.totalSolarMw === 'number';
    const netLoadMw = hasRenewables
      ? hourSummary.totalLoadMw - hourSummary.totalWindMw - hourSummary.totalSolarMw
      : null;
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-nc-ink-dim">
        <div>Load <strong className="text-nc-ink font-medium">{(hourSummary.totalLoadMw / 1000).toFixed(2)} GW</strong></div>
        <div>freq <strong className="text-nc-ink font-medium">{hourSummary.frequencyHz.toFixed(2)} Hz</strong></div>
        {hasRenewables ? (
          <>
            <div>Wind <strong className="text-nc-ink font-medium">{(hourSummary.totalWindMw / 1000).toFixed(2)} GW</strong></div>
            <div>Solar <strong className="text-nc-ink font-medium">{(hourSummary.totalSolarMw / 1000).toFixed(2)} GW</strong></div>
            <div>Net-load <strong className="text-nc-ink font-medium">{(netLoadMw! / 1000).toFixed(2)} GW</strong></div>
          </>
        ) : (
          <>
            <div>Wind <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
            <div>Solar <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
          </>
        )}
      </div>
    );
  }

  if (ercotData?.gridStatus) {
    const { gridStatus } = ercotData;
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-nc-ink-dim">
        <div>Load <strong className="text-nc-ink font-medium">{(gridStatus.totalLoadMw / 1000).toFixed(2)} GW</strong></div>
        <div>freq <strong className="text-nc-ink font-medium">59.97 Hz</strong></div>
        <div>Wind <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
        <div>Solar <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[11px] text-nc-ink-dim">
      <div>Load <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
      <div>Wind <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
      <div>Solar <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
      <div>Net-load <strong className="text-nc-ink-dim font-medium">Unavailable</strong></div>
    </div>
  );
}
