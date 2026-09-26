import { v4 as uuid } from 'uuid';
import type { Device, DeviceStatus } from './types.js';
import { SeededRandom } from './random.js';
import { ERCOT_ZONES } from './ercot.js';

const DEVICE_NAMES = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
  'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
  'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'
];

export interface DeviceSpec {
  maxPowerKw: number;
  capacityKwh: number;
  socPercent: number;
  reservePercent: number;
  zone: string;
  latitude: number;
  longitude: number;
}

/**
 * Simple Gulf of Mexico water check.
 * Returns true if point is likely in water (should be rejected).
 */
function isInGulf(lat: number, lng: number): boolean {
  if (lng > -94.0) return true;
  if (lat < 26.0) return true;
  if (lat < 27.5 && lng > -97.0) return true;
  if (lat < 28.5 && lng > -96.0) return true;
  if (lat < 29.5 && lng > -95.0) return true;
  return false;
}

/**
 * Generate lat/lng within zone bounds using rejection sampling.
 * Ensures all points are on land (not in Gulf of Mexico).
 */
function generateZonePosition(
  zone: string,
  rng: SeededRandom
): { latitude: number; longitude: number } {
  const zoneData = ERCOT_ZONES.find(z => z.id === zone);
  if (!zoneData) {
    return { latitude: 31.0, longitude: -99.0 };
  }
  
  const { bounds } = zoneData;
  const maxAttempts = 20;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const latitude = bounds.minLat + rng.next() * (bounds.maxLat - bounds.minLat);
    const longitude = bounds.minLng + rng.next() * (bounds.maxLng - bounds.minLng);
    
    if (!isInGulf(latitude, longitude)) {
      return { latitude, longitude };
    }
  }
  
  const [centroidLat, centroidLng] = zoneData.centroid;
  return { latitude: centroidLat, longitude: centroidLng };
}

export function createDevice(
  spec: Partial<DeviceSpec> = {},
  rng: SeededRandom,
  now: number,
  nameIndex: number
): Device {
  const nameSuffix = Math.floor(nameIndex / DEVICE_NAMES.length) || '';
  const baseName = DEVICE_NAMES[nameIndex % DEVICE_NAMES.length]!;
  
  const zone = spec.zone ?? rng.pick(ERCOT_ZONES.map(z => z.id))!;
  const position = spec.latitude !== undefined && spec.longitude !== undefined
    ? { latitude: spec.latitude, longitude: spec.longitude }
    : generateZonePosition(zone, rng);
  
  return {
    id: uuid(),
    name: `${baseName}${nameSuffix}-${rng.int(100, 999)}`,
    maxPowerKw: spec.maxPowerKw ?? rng.float(5, 15),
    capacityKwh: spec.capacityKwh ?? rng.float(10, 30),
    socPercent: spec.socPercent ?? rng.float(40, 95),
    reservePercent: spec.reservePercent ?? 20,
    status: 'online',
    lastTelemetryAt: now,
    epoch: 1,
    lastSequence: 0,
    processedKeys: new Set(),
    zone,
    latitude: position.latitude,
    longitude: position.longitude,
    currentSetpointKw: 0,
  };
}

export function seedFleet(
  count: number,
  seed: number,
  now: number
): Device[] {
  const rng = new SeededRandom(seed);
  const devices: Device[] = [];
  
  for (let i = 0; i < count; i++) {
    devices.push(createDevice({}, rng, now, i));
  }
  
  return devices;
}

export function getAvailablePowerKw(device: Device): number {
  if (device.status !== 'online') return 0;
  
  const availableSoc = Math.max(0, device.socPercent - device.reservePercent);
  const availableEnergyKwh = (availableSoc / 100) * device.capacityKwh;
  return Math.min(device.maxPowerKw, availableEnergyKwh);
}

export function setDeviceStatus(device: Device, status: DeviceStatus, now: number): Device {
  const updated = { ...device, status };
  
  if (status === 'online' && device.status !== 'online') {
    updated.epoch = device.epoch + 1;
    updated.lastSequence = 0;
    updated.lastTelemetryAt = now;
  }
  
  return updated;
}

export function updateDeviceTelemetry(device: Device, now: number): Device {
  return { ...device, lastTelemetryAt: now };
}

export function isTelemetryFresh(device: Device, now: number, thresholdMs: number): boolean {
  return now - device.lastTelemetryAt < thresholdMs;
}

export function applyCommandEffect(
  device: Device,
  setpointKw: number,
  durationHours: number
): Device {
  const energyConsumedKwh = setpointKw * durationHours;
  const socDelta = (energyConsumedKwh / device.capacityKwh) * 100;
  const newSoc = Math.max(device.reservePercent, device.socPercent - socDelta);
  
  return { ...device, socPercent: newSoc };
}
