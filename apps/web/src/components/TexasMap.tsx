'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import type { Device, FleetEvent, ErcotCacheData, Dispatch } from '@fleetfail/engine';

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
const Tooltip = dynamic(
  () => import('react-leaflet').then(mod => mod.Tooltip),
  { ssr: false }
);

interface TexasMapProps {
  devices: Device[];
  events: FleetEvent[];
  ercotData: ErcotCacheData | null;
  dispatch: Dispatch | null;
  onDeviceClick: (deviceId: string) => void;
  onZoneClick?: (zoneId: string) => void;
}

const TEXAS_CENTER: [number, number] = [31.0, -99.5];
const TEXAS_ZOOM = 6;

export function TexasMap({ devices, events, ercotData, dispatch, onDeviceClick, onZoneClick }: TexasMapProps) {
  const [mounted, setMounted] = useState(false);
  const [recentReallocations, setRecentReallocations] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const recentEvents = events.slice(-100);
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

  const isDispatchActive = dispatch && dispatch.status === 'executing';

  const getDeviceColor = (device: Device) => {
    if (device.status === 'offline') return '#ef4444';
    if (device.currentSetpointKw > 0) return '#22c55e';
    return '#3b82f6';
  };

  const getDeviceRadius = (device: Device) => {
    const baseRadius = 7;
    if (device.currentSetpointKw > 0) {
      return baseRadius + Math.min(device.currentSetpointKw / 2, 12);
    }
    return baseRadius;
  };

  const isDeviceWorking = (device: Device) => {
    return device.currentSetpointKw > 0;
  };

  const wasReallocatedTo = (device: Device) => {
    return recentReallocations.has(device.id) && device.currentSetpointKw > 0;
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
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        {devices.map((device) => {
          const working = isDeviceWorking(device);
          const reallocated = wasReallocatedTo(device);
          
          return (
            <CircleMarker
              key={device.id}
              center={[device.latitude, device.longitude]}
              radius={getDeviceRadius(device)}
              pathOptions={{
                fillColor: getDeviceColor(device),
                fillOpacity: device.status === 'offline' ? 0.4 : working ? 1.0 : 0.7,
                color: working ? '#ffffff' : reallocated ? '#fbbf24' : getDeviceColor(device),
                weight: working ? 4 : reallocated ? 3 : 1,
                className: working ? 'working-marker' : reallocated ? 'reallocated-marker' : '',
              }}
              eventHandlers={{
                click: () => {
                  if (device.status === 'online') {
                    onDeviceClick(device.id);
                  }
                },
              }}
            >
              {working && (
                <Tooltip permanent direction="top" offset={[0, -10]} className="kw-tooltip">
                  <span className="font-bold text-green-600">{device.currentSetpointKw.toFixed(1)} kW</span>
                </Tooltip>
              )}
              <Popup>
                <div className="text-slate-900 text-sm">
                  <div className="font-semibold">{device.name}</div>
                  <div>Zone: {device.zone}</div>
                  <div>Status: <span className={device.status === 'online' ? 'text-green-600' : 'text-red-600'}>{device.status}</span></div>
                  <div>SOC: {device.socPercent.toFixed(1)}%</div>
                  <div>Max Power: {device.maxPowerKw.toFixed(1)} kW</div>
                  {device.currentSetpointKw > 0 && (
                    <div className="text-green-600 font-bold text-lg">
                      ⚡ {device.currentSetpointKw.toFixed(1)} kW ACTIVE
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
          );
        })}
      </MapContainer>
      
      {/* Dispatch hint overlay */}
      {!isDispatchActive && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-800/90 text-amber-400 px-4 py-2 rounded-lg text-sm font-medium border border-amber-600/50 z-[1000]">
          💡 Start a dispatch first, then click devices offline to see reallocation
        </div>
      )}
      
      <style jsx global>{`
        @keyframes pulse-working {
          0% { 
            opacity: 1; 
            transform: scale(1);
            filter: drop-shadow(0 0 8px #22c55e);
          }
          50% { 
            opacity: 0.7; 
            transform: scale(1.15);
            filter: drop-shadow(0 0 16px #22c55e);
          }
          100% { 
            opacity: 1; 
            transform: scale(1);
            filter: drop-shadow(0 0 8px #22c55e);
          }
        }
        @keyframes glow-reallocated {
          0%, 100% { 
            filter: drop-shadow(0 0 4px #fbbf24);
          }
          50% { 
            filter: drop-shadow(0 0 12px #fbbf24);
          }
        }
        .working-marker {
          animation: pulse-working 0.8s ease-in-out infinite;
        }
        .reallocated-marker {
          animation: glow-reallocated 1s ease-in-out infinite;
        }
        .kw-tooltip {
          background: rgba(0, 0, 0, 0.9) !important;
          border: 2px solid #22c55e !important;
          border-radius: 4px !important;
          padding: 2px 6px !important;
          font-size: 11px !important;
          font-weight: bold !important;
          color: #22c55e !important;
          box-shadow: 0 0 10px rgba(34, 197, 94, 0.5) !important;
        }
        .kw-tooltip::before {
          border-top-color: #22c55e !important;
        }
        .leaflet-tooltip-top:before {
          border-top-color: #22c55e !important;
        }
      `}</style>
    </div>
  );
}
