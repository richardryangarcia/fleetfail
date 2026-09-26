'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';
import type { Device, FleetEvent, ErcotCacheData, Dispatch } from '@fleetfail/engine';
import L from 'leaflet';
import 'leaflet.markercluster';
import { useMap } from 'react-leaflet';

const MapContainer = dynamic(
  () => import('react-leaflet').then(mod => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then(mod => mod.TileLayer),
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

const FLEET_CENTER: [number, number] = [36.0, -94.0];
const FLEET_ZOOM = 5;

function createDeviceIcon(device: Device, isWorking: boolean, isReallocated: boolean): L.DivIcon {
  let bgColor = '#3b82f6';
  let borderColor = bgColor;
  let size = 12;
  let extraClass = '';
  
  if (device.status === 'offline') {
    bgColor = '#ef4444';
    borderColor = '#ef4444';
  } else if (isWorking) {
    bgColor = '#22c55e';
    borderColor = '#ffffff';
    size = 18;
    extraClass = 'working-marker';
  } else if (isReallocated) {
    borderColor = '#fbbf24';
  }
  
  const html = `
    <div class="device-marker ${extraClass}" style="
      width: ${size}px;
      height: ${size}px;
      background: ${bgColor};
      border: 2px solid ${borderColor};
      border-radius: 50%;
      box-shadow: 0 0 4px rgba(0,0,0,0.5);
    "></div>
    ${isWorking ? `<div class="kw-label">${device.currentSetpointKw.toFixed(0)}kW</div>` : ''}
  `;
  
  return L.divIcon({
    className: 'custom-device-icon',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function ClusterLayer({ 
  devices, 
  onDeviceClick, 
  recentReallocations 
}: { 
  devices: Device[]; 
  onDeviceClick: (deviceId: string) => void;
  recentReallocations: Set<string>;
}) {
  const map = useMap();
  const clusterGroupRef = useRef<L.MarkerClusterGroup | null>(null);
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  
  useEffect(() => {
    if (!map || typeof window === 'undefined') return;
    
    if (clusterGroupRef.current) {
      map.removeLayer(clusterGroupRef.current);
      clusterGroupRef.current = null;
    }
    
    const clusterGroup = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 10,
        iconCreateFunction: (cluster) => {
          const childCount = cluster.getChildCount();
          const markers = cluster.getAllChildMarkers();
          
          let offlineCount = 0;
          let workingCount = 0;
          
          markers.forEach((m) => {
            const device = (m as L.Marker & { deviceData?: Device }).deviceData;
            if (device) {
              if (device.status === 'offline') offlineCount++;
              if (device.currentSetpointKw > 0) workingCount++;
            }
          });
          
          let bgColor = '#3b82f6';
          if (offlineCount > childCount * 0.3) bgColor = '#ef4444';
          else if (workingCount > 0) bgColor = '#22c55e';
          
          const size = childCount < 100 ? 40 : childCount < 1000 ? 50 : 60;
          
          return L.divIcon({
            html: `
              <div class="cluster-marker" style="
                width: ${size}px;
                height: ${size}px;
                background: ${bgColor};
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: ${childCount < 100 ? '12px' : '11px'};
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                border: 2px solid rgba(255,255,255,0.3);
              ">
                ${childCount >= 1000 ? (childCount / 1000).toFixed(1) + 'k' : childCount}
              </div>
            `,
            className: 'custom-cluster-icon',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
        },
      });
      
      devicesRef.current.forEach(device => {
        const isWorking = device.currentSetpointKw > 0;
        const isReallocated = recentReallocations.has(device.id) && isWorking;
        const icon = createDeviceIcon(device, isWorking, isReallocated);
        
        const marker = L.marker([device.latitude, device.longitude], { icon }) as L.Marker & { deviceData?: Device };
        marker.deviceData = device;
        
        const popupContent = `
          <div class="device-popup">
            <div style="font-weight: 600">${device.name}</div>
            <div>Region: ${device.region} | Zone: ${device.zone}</div>
            <div>Gen: ${device.generation.toUpperCase()} (${device.maxPowerKw}kW)</div>
            <div>Status: <span style="color: ${device.status === 'online' ? '#22c55e' : '#ef4444'}">${device.status}</span></div>
            <div>SOC: ${device.socPercent.toFixed(1)}%</div>
            ${device.currentSetpointKw > 0 ? `<div style="color: #22c55e; font-weight: bold;">⚡ ${device.currentSetpointKw.toFixed(1)} kW ACTIVE</div>` : ''}
          </div>
        `;
        
        marker.bindPopup(popupContent);
        
        if (device.status === 'online') {
          marker.on('click', () => {
            onDeviceClick(device.id);
          });
        }
        
        clusterGroup.addLayer(marker);
    });
    
    map.addLayer(clusterGroup);
    clusterGroupRef.current = clusterGroup;
    
    return () => {
      if (clusterGroupRef.current && map) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
      }
    };
  }, [map, devices, onDeviceClick, recentReallocations]);
  
  return null;
}

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
        <div className="text-slate-400">Loading Fleet Map...</div>
      </div>
    );
  }

  const isDispatchActive = dispatch && dispatch.status === 'executing';

  const deviceSummary = useMemo(() => {
    const txDevices = devices.filter(d => d.region === 'TX');
    const ilDevices = devices.filter(d => d.region === 'IL');
    return {
      total: devices.length,
      tx: txDevices.length,
      il: ilDevices.length,
      online: devices.filter(d => d.status === 'online').length,
      working: devices.filter(d => d.currentSetpointKw > 0).length,
    };
  }, [devices]);

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={FLEET_CENTER}
        zoom={FLEET_ZOOM}
        className="w-full h-full"
        style={{ background: '#0f172a' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <ClusterLayer 
          devices={devices} 
          onDeviceClick={onDeviceClick}
          recentReallocations={recentReallocations}
        />
      </MapContainer>
      
      {/* Device count overlay */}
      <div className="absolute bottom-4 left-4 bg-slate-800/90 text-white px-3 py-2 rounded-lg text-xs z-[1000] border border-slate-600">
        <div className="font-semibold mb-1">Fleet: {deviceSummary.total.toLocaleString()} devices</div>
        <div className="flex gap-3 text-slate-300">
          <span>TX: {deviceSummary.tx.toLocaleString()}</span>
          <span>IL: {deviceSummary.il.toLocaleString()}</span>
        </div>
        <div className="flex gap-3 text-slate-300">
          <span className="text-green-400">Online: {deviceSummary.online.toLocaleString()}</span>
          {deviceSummary.working > 0 && (
            <span className="text-emerald-400 font-bold">Working: {deviceSummary.working}</span>
          )}
        </div>
      </div>
      
      {/* Dispatch hint overlay */}
      {!isDispatchActive && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-800/90 text-amber-400 px-4 py-2 rounded-lg text-sm font-medium border border-amber-600/50 z-[1000]">
          Start a dispatch, then click device clusters to zoom in and take devices offline
        </div>
      )}
      
      <style jsx global>{`
        @keyframes pulse-working {
          0% { 
            transform: scale(1);
            box-shadow: 0 0 4px #22c55e;
          }
          50% { 
            transform: scale(1.2);
            box-shadow: 0 0 12px #22c55e;
          }
          100% { 
            transform: scale(1);
            box-shadow: 0 0 4px #22c55e;
          }
        }
        .working-marker {
          animation: pulse-working 0.8s ease-in-out infinite;
        }
        .custom-device-icon {
          background: transparent !important;
          border: none !important;
        }
        .custom-cluster-icon {
          background: transparent !important;
          border: none !important;
        }
        .kw-label {
          position: absolute;
          top: -18px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(0, 0, 0, 0.9);
          color: #22c55e;
          font-size: 10px;
          font-weight: bold;
          padding: 1px 4px;
          border-radius: 3px;
          border: 1px solid #22c55e;
          white-space: nowrap;
        }
        .device-popup {
          font-size: 12px;
          line-height: 1.4;
        }
        .cluster-marker {
          transition: transform 0.2s;
        }
        .cluster-marker:hover {
          transform: scale(1.1);
        }
        .leaflet-marker-icon {
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
