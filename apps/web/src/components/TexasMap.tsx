'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import type { Device, FleetEvent, ErcotCacheData } from '@fleetfail/engine';

const MapContainer = dynamic(
  () => import('react-leaflet').then(mod => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then(mod => mod.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import('react-leaflet').then(mod => mod.CircleMarker),
  { ssr: false }
);
const Popup = dynamic(
  () => import('react-leaflet').then(mod => mod.Popup),
  { ssr: false }
);
const Polygon = dynamic(
  () => import('react-leaflet').then(mod => mod.Polygon),
  { ssr: false }
);

interface TexasMapProps {
  devices: Device[];
  events: FleetEvent[];
  ercotData: ErcotCacheData | null;
  onDeviceClick: (deviceId: string) => void;
  onZoneClick?: (zoneId: string) => void;
}

const TEXAS_CENTER: [number, number] = [31.0, -99.5];
const TEXAS_ZOOM = 6;

const ZONE_COLORS: Record<string, string> = {
  COAST: '#3b82f6',
  EAST: '#22c55e',
  FAR_WEST: '#f97316',
  NORTH: '#8b5cf6',
  NORTH_C: '#ec4899',
  SOUTH_C: '#14b8a6',
  SOUTHERN: '#eab308',
  WEST: '#ef4444',
};

export function TexasMap({ devices, events, ercotData, onDeviceClick, onZoneClick }: TexasMapProps) {
  const [mounted, setMounted] = useState(false);
  const [recentReallocations, setRecentReallocations] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const recentEvents = events.slice(-50);
    const reallocatedDevices = new Set<string>();
    
    for (const event of recentEvents) {
      if (event.type === 'REALLOCATED') {
        const toDeviceId = (event.details as { toDeviceId: string }).toDeviceId;
        if (toDeviceId) reallocatedDevices.add(toDeviceId);
      }
      if (event.type === 'COMMAND_ACKED' && event.deviceId) {
        reallocatedDevices.add(event.deviceId);
      }
    }
    
    setRecentReallocations(reallocatedDevices);
  }, [events]);

  if (!mounted) {
    return (
      <div className="w-full h-full bg-slate-900 flex items-center justify-center">
        <div className="text-slate-400">Loading Texas Map...</div>
      </div>
    );
  }

  const getDeviceColor = (device: Device) => {
    if (device.status === 'offline') return '#ef4444';
    if (device.currentSetpointKw > 0) return '#22c55e';
    return '#3b82f6';
  };

  const getDeviceRadius = (device: Device) => {
    const baseRadius = 6;
    if (device.currentSetpointKw > 0) {
      return baseRadius + Math.min(device.currentSetpointKw / 3, 8);
    }
    return baseRadius;
  };

  const isDeviceWorking = (device: Device) => {
    return device.currentSetpointKw > 0 || recentReallocations.has(device.id);
  };

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={TEXAS_CENTER}
        zoom={TEXAS_ZOOM}
        className="w-full h-full"
        style={{ background: '#0f172a' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        {devices.map((device) => (
          <CircleMarker
            key={device.id}
            center={[device.latitude, device.longitude]}
            radius={getDeviceRadius(device)}
            pathOptions={{
              fillColor: getDeviceColor(device),
              fillOpacity: device.status === 'offline' ? 0.5 : 0.9,
              color: isDeviceWorking(device) ? '#ffffff' : getDeviceColor(device),
              weight: isDeviceWorking(device) ? 3 : 1,
              className: isDeviceWorking(device) ? 'working-marker' : '',
            }}
            eventHandlers={{
              click: () => {
                if (device.status === 'online') {
                  onDeviceClick(device.id);
                }
              },
            }}
          >
            <Popup>
              <div className="text-slate-900 text-sm">
                <div className="font-semibold">{device.name}</div>
                <div>Zone: {device.zone}</div>
                <div>Status: <span className={device.status === 'online' ? 'text-green-600' : 'text-red-600'}>{device.status}</span></div>
                <div>SOC: {device.socPercent.toFixed(1)}%</div>
                <div>Max Power: {device.maxPowerKw.toFixed(1)} kW</div>
                {device.currentSetpointKw > 0 && (
                  <div className="text-green-600 font-semibold">
                    Active: {device.currentSetpointKw.toFixed(1)} kW
                  </div>
                )}
                {device.status === 'online' && (
                  <button
                    onClick={() => onDeviceClick(device.id)}
                    className="mt-2 px-2 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700"
                  >
                    Take Offline
                  </button>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      
      <style jsx global>{`
        @keyframes pulse-working {
          0%, 100% { opacity: 0.9; }
          50% { opacity: 0.6; }
        }
        .working-marker {
          animation: pulse-working 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
