import type { Device } from './types.js';
import { getAvailablePowerKw } from './device.js';
import { ALL_ZONES, type GridZone } from './ercot.js';

export interface ZoneAllocation {
  zone: GridZone;
  devices: Device[];
  totalCapacityKw: number;
  availableCapacityKw: number;
  onlineCount: number;
  offlineCount: number;
}

/**
 * Groups devices by their zone and calculates zone-level capacity.
 * Supports both TX (ERCOT) and IL (MISO) zones.
 */
export function getZoneAllocations(devices: Device[]): ZoneAllocation[] {
  const zoneMap = new Map<string, Device[]>();
  
  for (const device of devices) {
    const existing = zoneMap.get(device.zone) ?? [];
    existing.push(device);
    zoneMap.set(device.zone, existing);
  }
  
  return ALL_ZONES.map(zone => {
    const zoneDevices = zoneMap.get(zone.id) ?? [];
    const online = zoneDevices.filter(d => d.status === 'online');
    const offline = zoneDevices.filter(d => d.status !== 'online');
    
    return {
      zone,
      devices: zoneDevices,
      totalCapacityKw: zoneDevices.reduce((sum, d) => sum + d.maxPowerKw, 0),
      availableCapacityKw: online.reduce((sum, d) => sum + getAvailablePowerKw(d), 0),
      onlineCount: online.length,
      offlineCount: offline.length,
    };
  }).filter(za => za.devices.length > 0);
}

export interface ZonePreference {
  zoneId: string;
  weight: number;
}

/**
 * Sort devices by zone preference for dispatch allocation
 * Higher weighted zones are allocated from first
 */
export function sortDevicesByZonePreference(
  devices: Device[],
  preferences: ZonePreference[]
): Device[] {
  const weightMap = new Map<string, number>();
  for (const pref of preferences) {
    weightMap.set(pref.zoneId, pref.weight);
  }
  
  return [...devices].sort((a, b) => {
    const weightA = weightMap.get(a.zone) ?? 0;
    const weightB = weightMap.get(b.zone) ?? 0;
    
    if (weightB !== weightA) {
      return weightB - weightA;
    }
    
    return getAvailablePowerKw(b) - getAvailablePowerKw(a);
  });
}

/**
 * Creates default zone preferences based on net load.
 * Zones with higher net load get higher priority (more need for DR).
 * Supports both TX (ERCOT) and IL (MISO) zones.
 */
export function createLoadBasedPreferences(): ZonePreference[] {
  const maxLoad = Math.max(...ALL_ZONES.map(z => z.netLoadMw));
  
  return ALL_ZONES.map(zone => ({
    zoneId: zone.id,
    weight: zone.netLoadMw / maxLoad,
  }));
}
