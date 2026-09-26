'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { Device, FleetMetrics, FleetEvent, Dispatch, ErcotCacheData } from '@fleetfail/engine';
import { MapSideStrip } from '@/components/MapSideStrip';

const TexasMap = dynamic(
  () => import('@/components/TexasMap').then(mod => mod.TexasMap),
  { 
    ssr: false,
    loading: () => (
      <div className="flex-1 bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading Texas Map...</div>
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

  const fetchState = useCallback(async () => {
    try {
      const [stateRes, ercotRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/ercot-cache'),
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
      body: JSON.stringify({ targetKw }),
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
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-xl text-slate-300">Loading FleetFail Map...</div>
      </div>
    );
  }

  return (
    <main className="h-screen flex overflow-hidden">
      <div className="flex-1 relative">
        <TexasMap
          devices={state.devices}
          events={state.events}
          ercotData={ercotData}
          onDeviceClick={handleDeviceClick}
          onZoneClick={handleMassOutage}
        />
      </div>
      <MapSideStrip
        metrics={state.metrics}
        dispatch={state.activeDispatch}
        ercotData={ercotData}
        isRunning={state.isRunning}
        onStartDispatch={handleStartDispatch}
        onMassOutage={handleMassOutage}
        onRestoreAll={handleRestoreAll}
      />
    </main>
  );
}
