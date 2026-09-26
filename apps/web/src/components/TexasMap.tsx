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
  let bgColor = '#4a5260';
  let borderColor = bgColor;
  let size = 12;
  let extraClass = '';
  
  if (device.status === 'offline') {
    bgColor = '#e05454';
    borderColor = '#e05454';
  } else if (isWorking) {
    bgColor = '#3dba7a';
    borderColor = '#f0a020';
    size = 18;
    extraClass = 'working-marker';
  } else if (isReallocated) {
    borderColor = '#f0a020';
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

function createPopupContent(device: Device): string {
  return `
    <div class="device-popup">
      <div style="font-weight: 600; color: #e8edf2;">${device.name}</div>
      <div style="color: #6b7380;">Region: ${device.region} | Zone: ${device.zone}</div>
      <div style="color: #6b7380;">Gen: ${device.generation.toUpperCase()} (${device.maxPowerKw}kW)</div>
      <div style="color: #6b7380;">Status: <span style="color: ${device.status === 'online' ? '#3dba7a' : '#e05454'}">${device.status}</span></div>
      <div style="color: #6b7380;">SOC: <span style="color: #c8ced6;">${device.socPercent.toFixed(1)}%</span></div>
      ${device.currentSetpointKw > 0 ? `<div style="color: #f0a020; font-weight: bold;">⚡ ${device.currentSetpointKw.toFixed(1)} kW ACTIVE</div>` : ''}
    </div>
  `;
}

type DeviceMarker = L.Marker & { deviceData?: Device };

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
  const markersRef = useRef<Map<string, DeviceMarker>>(new Map());
  const onDeviceClickRef = useRef(onDeviceClick);
  onDeviceClickRef.current = onDeviceClick;

  useEffect(() => {
    if (!map || typeof window === 'undefined') return;
    
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
          const device = (m as DeviceMarker).deviceData;
          if (device) {
            if (device.status === 'offline') offlineCount++;
            if (device.currentSetpointKw > 0) workingCount++;
          }
        });
        
        let bgColor = '#4a5260';
        if (offlineCount > childCount * 0.3) bgColor = '#e05454';
        else if (workingCount > 0) bgColor = '#3dba7a';
        
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
    
    map.addLayer(clusterGroup);
    clusterGroupRef.current = clusterGroup;
    
    return () => {
      if (clusterGroupRef.current && map) {
        map.removeLayer(clusterGroupRef.current);
        clusterGroupRef.current = null;
      }
      markersRef.current.clear();
    };
  }, [map]);

  useEffect(() => {
    const clusterGroup = clusterGroupRef.current;
    if (!clusterGroup) return;

    const currentDeviceIds = new Set(devices.map(d => d.id));
    const existingMarkers = markersRef.current;

    for (const [deviceId, marker] of existingMarkers) {
      if (!currentDeviceIds.has(deviceId)) {
        clusterGroup.removeLayer(marker);
        existingMarkers.delete(deviceId);
      }
    }

    for (const device of devices) {
      const existingMarker = existingMarkers.get(device.id);
      const isWorking = device.currentSetpointKw > 0;
      const isReallocated = recentReallocations.has(device.id) && isWorking;
      const newIcon = createDeviceIcon(device, isWorking, isReallocated);

      if (existingMarker) {
        existingMarker.deviceData = device;
        existingMarker.setIcon(newIcon);
        existingMarker.setPopupContent(createPopupContent(device));

        existingMarker.off('click');
        if (device.status === 'online') {
          existingMarker.on('click', () => {
            onDeviceClickRef.current(device.id);
          });
        }
      } else {
        const marker = L.marker([device.latitude, device.longitude], { icon: newIcon }) as DeviceMarker;
        marker.deviceData = device;
        marker.bindPopup(createPopupContent(device));

        if (device.status === 'online') {
          marker.on('click', () => {
            onDeviceClickRef.current(device.id);
          });
        }

        clusterGroup.addLayer(marker);
        existingMarkers.set(device.id, marker);
      }
    }

    clusterGroup.refreshClusters();
  }, [devices, recentReallocations]);
  
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

  if (!mounted) {
    return (
      <div className="w-full h-full bg-nc-bg flex items-center justify-center">
        <div className="text-nc-ink-mute font-mono text-sm">Loading Fleet Map...</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      <MapContainer
        center={FLEET_CENTER}
        zoom={FLEET_ZOOM}
        className="w-full h-full"
        style={{ background: '#0a0b0d' }}
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
      
      {/* Device count overlay - Night Console style */}
      <div className="absolute bottom-4 left-4 bg-nc-elev/95 px-3 py-2 text-xs z-[1000] border border-nc-line-strong">
        <div className="font-mono font-semibold text-nc-num mb-1">Fleet: {deviceSummary.total.toLocaleString()} devices</div>
        <div className="flex gap-3 font-mono text-nc-ink-dim text-[11px] tabular-nums">
          <span>TX: {deviceSummary.tx.toLocaleString()}</span>
          <span>IL: {deviceSummary.il.toLocaleString()}</span>
        </div>
        <div className="flex gap-3 font-mono text-[11px] tabular-nums">
          <span className="text-nc-ok">Online: {deviceSummary.online.toLocaleString()}</span>
          {deviceSummary.working > 0 && (
            <span className="text-nc-accent font-semibold">Working: {deviceSummary.working}</span>
          )}
        </div>
      </div>
      
      {/* Dispatch hint overlay - Night Console style */}
      {!isDispatchActive && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-nc-elev/95 text-nc-accent px-4 py-2 text-[12px] font-mono border border-nc-accent-dim z-[1000]">
          Start a dispatch, then click device clusters to zoom in and take devices offline
        </div>
      )}
      
      <style jsx global>{`
        @keyframes pulse-working {
          0% { 
            transform: scale(1);
            box-shadow: 0 0 4px #3dba7a;
          }
          50% { 
            transform: scale(1.2);
            box-shadow: 0 0 12px #3dba7a;
          }
          100% { 
            transform: scale(1);
            box-shadow: 0 0 4px #3dba7a;
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
          background: #0a0b0d;
          color: #f0a020;
          font-size: 10px;
          font-weight: bold;
          font-family: "SF Mono", "IBM Plex Mono", ui-monospace, monospace;
          padding: 1px 4px;
          border: 1px solid #a87018;
          white-space: nowrap;
        }
        .device-popup {
          font-size: 11px;
          line-height: 1.5;
          font-family: "SF Mono", "IBM Plex Mono", ui-monospace, monospace;
          background: #111318;
          color: #c8ced6;
          padding: 8px;
          margin: -14px -20px;
        }
        .leaflet-popup-content-wrapper {
          background: #111318 !important;
          border: 1px solid #2a3038 !important;
          border-radius: 0 !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
        }
        .leaflet-popup-tip {
          background: #111318 !important;
          border: 1px solid #2a3038 !important;
        }
        .leaflet-popup-close-button {
          color: #6b7380 !important;
        }
        .leaflet-popup-close-button:hover {
          color: #c8ced6 !important;
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
        .leaflet-control-attribution {
          background: rgba(10, 11, 13, 0.8) !important;
          color: #4a5260 !important;
          font-size: 9px !important;
        }
        .leaflet-control-attribution a {
          color: #6b7380 !important;
        }
      `}</style>
    </div>
  );
}
