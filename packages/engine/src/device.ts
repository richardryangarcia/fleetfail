import type { Device, DeviceStatus, DeviceGeneration, DeviceRegion } from './types.js';
import { SeededRandom } from './random.js';
import { ALL_ZONES, type GridZone } from './ercot.js';

export interface DeviceSpec {
  maxPowerKw: number;
  capacityKwh: number;
  socPercent: number;
  reservePercent: number;
  zone: string;
  region: DeviceRegion;
  generation: DeviceGeneration;
  latitude: number;
  longitude: number;
}

const GEN_SPECS: Record<DeviceGeneration, { maxPowerKw: number; capacityKwh: number }> = {
  gen1: { maxPowerKw: 25, capacityKwh: 50 },
  gen3: { maxPowerKw: 40, capacityKwh: 80 },
};

/**
 * Simple Gulf of Mexico water check for TX zones.
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
 */
function generateZonePosition(
  zoneData: GridZone,
  rng: SeededRandom
): { latitude: number; longitude: number } {
  const { bounds, region } = zoneData;
  const maxAttempts = 20;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const latitude = bounds.minLat + rng.next() * (bounds.maxLat - bounds.minLat);
    const longitude = bounds.minLng + rng.next() * (bounds.maxLng - bounds.minLng);
    
    if (region === 'IL' || !isInGulf(latitude, longitude)) {
      return { latitude, longitude };
    }
  }
  
  const [centroidLat, centroidLng] = zoneData.centroid;
  return { latitude: centroidLat, longitude: centroidLng };
}

export function createDevice(
  spec: Partial<DeviceSpec>,
  rng: SeededRandom,
  now: number,
  deviceIndex: number
): Device {
  const zone = spec.zone ?? rng.pick(ALL_ZONES)!;
  const zoneData = typeof zone === 'string' ? ALL_ZONES.find(z => z.id === zone) : zone;
  
  if (!zoneData) {
    throw new Error(`Unknown zone: ${zone}`);
  }

  const region = spec.region ?? zoneData.region;
  const generation = spec.generation ?? (rng.chance(0.6) ? 'gen1' : 'gen3');
  const genSpec = GEN_SPECS[generation];
  
  const position = spec.latitude !== undefined && spec.longitude !== undefined
    ? { latitude: spec.latitude, longitude: spec.longitude }
    : generateZonePosition(zoneData, rng);
  
  const id = `dev-${deviceIndex.toString(36).padStart(5, '0')}`;
  
  return {
    id,
    name: `${region}-${generation.toUpperCase()}-${deviceIndex}`,
    maxPowerKw: spec.maxPowerKw ?? genSpec.maxPowerKw,
    capacityKwh: spec.capacityKwh ?? genSpec.capacityKwh,
    socPercent: spec.socPercent ?? rng.float(40, 95),
    reservePercent: spec.reservePercent ?? 20,
    status: 'online',
    lastTelemetryAt: now,
    epoch: 1,
    lastSequence: 0,
    processedKeys: new Set(),
    zone: zoneData.id,
    region,
    generation,
    latitude: position.latitude,
    longitude: position.longitude,
    currentSetpointKw: 0,
  };
}

export interface FleetConfig {
  count: number;
  seed: number;
  now: number;
  txRatio?: number;
}

/**
 * Seed a large fleet efficiently with TX + IL distribution.
 * Default 70% TX, 30% IL to match ERCOT focus.
 */
export function seedFleet(
  count: number,
  seed: number,
  now: number,
  txRatio: number = 0.7
): Device[] {
  const rng = new SeededRandom(seed);
  const devices: Device[] = [];
  
  const txZones = ALL_ZONES.filter(z => z.region === 'TX');
  const ilZones = ALL_ZONES.filter(z => z.region === 'IL');
  
  for (let i = 0; i < count; i++) {
    const isTx = rng.next() < txRatio;
    const zone = isTx ? rng.pick(txZones)! : rng.pick(ilZones)!;
    
    devices.push(createDevice({ zone: zone.id, region: zone.region }, rng, now, i));
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
