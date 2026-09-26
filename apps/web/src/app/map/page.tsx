'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { Device, FleetMetrics, FleetEvent, Dispatch, ErcotCacheData, PriceCacheData } from '@fleetfail/engine';
import { MapSideStrip } from '@/components/MapSideStrip';
import { HourSlider } from '@/components/HourSlider';

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
}

export default function MapPage() {
  const [state, setState] = useState<MapState | null>(null);
  const [ercotData, setErcotData] = useState<ErcotCacheData | null>(null);
  const [priceData, setPriceData] = useState<PriceCacheData | null>(null);
  const [selectedHourKey, setSelectedHourKey] = useState<string | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const hourParam = selectedHourKey ? `?hourKey=${encodeURIComponent(selectedHourKey)}` : '';
      const [stateRes, ercotRes, priceRes] = await Promise.all([
        fetch('/api/state'),
        fetch(`/api/ercot-cache${hourParam}`),
        fetch('/api/ercot-prices'),
      ]);
      const [stateData, ercotDataRes, priceDataRes] = await Promise.all([
        stateRes.json(),
        ercotRes.json(),
        priceRes.json(),
      ]);
      setState(stateData);
      setErcotData(ercotDataRes);
      setPriceData(priceDataRes);
      
      if (!selectedHourKey && ercotDataRes.currentHourKey) {
        setSelectedHourKey(ercotDataRes.currentHourKey);
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
    
    const count = Math.min(10, devicesToOffline.length);
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

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-nc-bg">
        <div className="text-sm font-mono text-nc-ink-mute">Loading FleetFail Map...</div>
      </div>
    );
  }

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
            devices={state.devices}
            events={state.events}
            ercotData={ercotData}
            dispatch={state.activeDispatch}
            onDeviceClick={handleDeviceClick}
            onZoneClick={handleMassOutage}
          />
        </div>
        <MapSideStrip
          metrics={state.metrics}
          dispatch={state.activeDispatch}
          ercotData={ercotData}
          priceData={priceData}
          isRunning={state.isRunning}
          onStartDispatch={handleStartDispatch}
          onMassOutage={handleMassOutage}
          onRestoreAll={handleRestoreAll}
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
