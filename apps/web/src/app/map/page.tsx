'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { Device, FleetMetrics, FleetEvent, Dispatch, ErcotCacheData, PriceCacheData } from '@fleetfail/engine';
import { MapSideStrip, type ArbModeState } from '@/components/MapSideStrip';
import { HourSlider } from '@/components/HourSlider';

const PRICE_REFRESH_MS = 15 * 60 * 1000; // 15 minutes - aligned with RT SPP TTL

const TexasMap = dynamic(
  () => import('@/components/TexasMap').then(mod => mod.TexasMap),
  { 
    ssr: false,
    loading: () => (
      <div className="flex-1 bg-nc-bg flex items-center justify-center">
        <div className="text-nc-ink-mute font-mono text-sm">Loading Texas Map...</div>
      </div>
    )
  }
);

interface MapState {
  devices: Device[];
  metrics: FleetMetrics;
  events: FleetEvent[];
  activeDispatch: Dispatch | null;
  isRunning: boolean;
  arbMode?: ArbModeState;
}

export default function MapPage() {
  const [state, setState] = useState<MapState | null>(null);
  const [ercotData, setErcotData] = useState<ErcotCacheData | null>(null);
  const [priceData, setPriceData] = useState<PriceCacheData | null>(null);
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);
  
  const selectedHourKeyRef = useRef<string | null>(null);
  selectedHourKeyRef.current = selectedHourKey;
  
  const lastStateFingerprintRef = useRef<string>('');
  const lastErcotFingerprintRef = useRef<string>('');
  const lastPriceFingerprintRef = useRef<string>('');

  const fetchState = useCallback(async () => {
    try {
      const currentHourKey = selectedHourKeyRef.current;
      const hourParam = currentHourKey ? `?hourKey=${encodeURIComponent(currentHourKey)}` : '';
      const [stateRes, ercotRes] = await Promise.all([
        fetch('/api/state'),
        fetch(`/api/ercot-cache${hourParam}`),
      ]);
      const [stateData, ercotDataRes] = await Promise.all([
        stateRes.json(),
        ercotRes.json(),
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
        dataSource: ercotDataRes.dataSource,
        currentHourKey: ercotDataRes.currentHourKey,
        totalLoadMw: ercotDataRes.gridSummary?.totalLoadMw,
        frequencyHz: ercotDataRes.gridSummary?.frequencyHz,
        hourlyDataLen: ercotDataRes.hourlyData?.length,
      });
      if (ercotFingerprint !== lastErcotFingerprintRef.current) {
        lastErcotFingerprintRef.current = ercotFingerprint;
        setErcotData(ercotDataRes);
      }
      
      if (!selectedHourKeyRef.current && ercotDataRes.currentHourKey) {
        setSelectedHourKey(ercotDataRes.currentHourKey);
      }
    } catch (error) {
      console.error('Failed to fetch state:', error);
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
    fetchPrices();
    const interval = setInterval(fetchPrices, PRICE_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchPrices]);
  
  const handleHourChange = useCallback((hourKey: string) => {
    setSelectedHourKey(hourKey);
  }, []);

  const handleDeviceClick = async (deviceId: string) => {
    await fetch('/api/fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, faultType: 'offline' }),
    });
    await fetchState();
  };

  const handleStartDispatch = async (targetKw: number) => {
    await fetch('/api/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetKw, selectedHourKey }),
    });
    await fetchState();
  };

  const handleMassOutage = async (zoneId?: string) => {
    if (!state) return;
    
    let devicesToOffline = state.devices.filter(d => d.status === 'online');
    
    if (zoneId) {
      devicesToOffline = devicesToOffline.filter(d => d.zone === zoneId);
    }
    
    const count = Math.min(100, devicesToOffline.length);
    for (let i = 0; i < count; i++) {
      await fetch('/api/fault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: devicesToOffline[i]!.id, faultType: 'offline' }),
      });
    }
    await fetchState();
  };

  const handleRestoreAll = async () => {
    if (!state) return;
    for (const device of state.devices.filter(d => d.status !== 'online')) {
      await fetch(`/api/fault?deviceId=${device.id}`, { method: 'DELETE' });
    }
    await fetchState();
  };

  const handleArmArb = async () => {
    if (!priceData?.arbEdge?.hasEdge) return;
    await fetch('/api/arb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'arm',
        chargeWindow: priceData.arbEdge.chargeWindow,
        dischargeWindow: priceData.arbEdge.dischargeWindow,
        spreadMwh: priceData.arbEdge.spreadMwh,
      }),
    });
    await fetchState();
  };

  const handleDisarmArb = async () => {
    await fetch('/api/arb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disarm' }),
    });
    await fetchState();
  };

  const handleExecuteArb = async (windowType: 'charge' | 'discharge', targetKw: number) => {
    const window = windowType === 'charge' 
      ? state?.arbMode?.chargeWindow 
      : state?.arbMode?.dischargeWindow;
    
    if (!window) return;
    
    await fetch('/api/arb', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'execute',
        targetKw,
        windowType,
        priceMwh: window.priceMwh,
        hourEnding: window.hourEnding,
      }),
    });
    await fetchState();
  };

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-nc-bg">
        <div className="text-sm font-mono text-nc-ink-mute">Loading FleetFail Map...</div>
      </div>
    );
  }

  const { 
    devices = [], 
    events = [], 
    metrics = {} as FleetMetrics, 
    activeDispatch, 
    isRunning 
  } = state;

  return (
    <div className="h-screen flex flex-col bg-nc-bg">
      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 relative">
          {/* Hour Slider at top of map */}
          {ercotData?.hourlyData && ercotData.hourlyData.length > 0 && selectedHourKey && ercotData.currentHourKey && (
            <div className="absolute top-3 left-3 right-3 z-10 max-w-md">
              <HourSlider
                hourlyData={ercotData.hourlyData}
                currentHourKey={ercotData.currentHourKey}
                selectedHourKey={selectedHourKey}
                onHourChange={handleHourChange}
              />
            </div>
          )}
          <TexasMap
            devices={devices}
            events={events}
            ercotData={ercotData}
            dispatch={activeDispatch}
            onDeviceClick={handleDeviceClick}
            onZoneClick={handleMassOutage}
          />
        </div>
        <MapSideStrip
          metrics={metrics}
          dispatch={activeDispatch}
          ercotData={ercotData}
          priceData={priceData}
          isRunning={isRunning}
          arbMode={state.arbMode ?? null}
          onStartDispatch={handleStartDispatch}
          onMassOutage={handleMassOutage}
          onRestoreAll={handleRestoreAll}
          onArmArb={handleArmArb}
          onDisarmArb={handleDisarmArb}
          onExecuteArb={handleExecuteArb}
        />
      </main>
      {/* SYNTHETIC DISCLAIMER - always visible */}
      <footer className="h-7 bg-nc-panel border-t border-nc-line-strong flex items-center px-4 shrink-0">
        <span className="text-[10px] font-mono tracking-wider text-nc-warn font-semibold uppercase mr-2">SYNTHETIC DISCLAIMER</span>
        <span className="text-[10px] font-mono tracking-wide text-nc-ink-mute uppercase">
          Simulated ERCOT / fleet telemetry for hackathon demo only. Not connected to live grid or production devices.
        </span>
      </footer>
    </div>
  );
}
