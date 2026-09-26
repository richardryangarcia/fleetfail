import type { Device } from './types.js';
import { SeededRandom } from './random.js';

export type FaultType = 
  | 'offline'
  | 'lost_ack'
  | 'delayed_ack'
  | 'duplicate_delivery'
  | 'stale_telemetry';

export interface FaultConfig {
  deviceId: string;
  faultType: FaultType;
  durationMs?: number;
  probability?: number;
}

export interface ActiveFault {
  deviceId: string;
  faultType: FaultType;
  startTime: number;
  endTime: number | null;
  triggeredCount: number;
}

export class FaultInjector {
  private activeFaults: Map<string, ActiveFault[]> = new Map();
  private rng: SeededRandom;

  constructor(seed: number) {
    this.rng = new SeededRandom(seed);
  }

  injectFault(fault: FaultConfig, now: number): ActiveFault {
    const active: ActiveFault = {
      deviceId: fault.deviceId,
      faultType: fault.faultType,
      startTime: now,
      endTime: fault.durationMs ? now + fault.durationMs : null,
      triggeredCount: 0,
    };

    const deviceFaults = this.activeFaults.get(fault.deviceId) ?? [];
    deviceFaults.push(active);
    this.activeFaults.set(fault.deviceId, deviceFaults);

    return active;
  }

  clearFault(deviceId: string, faultType: FaultType): void {
    const faults = this.activeFaults.get(deviceId);
    if (faults) {
      const updated = faults.filter(f => f.faultType !== faultType);
      if (updated.length > 0) {
        this.activeFaults.set(deviceId, updated);
      } else {
        this.activeFaults.delete(deviceId);
      }
    }
  }

  clearAllFaults(deviceId: string): void {
    this.activeFaults.delete(deviceId);
  }

  clearAllDeviceFaults(): void {
    this.activeFaults.clear();
  }

  getActiveFaults(deviceId: string, now: number): ActiveFault[] {
    const faults = this.activeFaults.get(deviceId) ?? [];
    const active = faults.filter(f => f.endTime === null || f.endTime > now);
    this.activeFaults.set(deviceId, active);
    return active;
  }

  hasFault(deviceId: string, faultType: FaultType, now: number): boolean {
    const faults = this.getActiveFaults(deviceId, now);
    return faults.some(f => f.faultType === faultType);
  }

  isDeviceOffline(deviceId: string, now: number): boolean {
    return this.hasFault(deviceId, 'offline', now);
  }

  shouldLoseAck(deviceId: string, now: number): boolean {
    return this.hasFault(deviceId, 'lost_ack', now);
  }

  shouldDelayAck(deviceId: string, now: number): boolean {
    return this.hasFault(deviceId, 'delayed_ack', now);
  }

  shouldDuplicateDelivery(deviceId: string, now: number): boolean {
    if (!this.hasFault(deviceId, 'duplicate_delivery', now)) {
      return false;
    }
    const faults = this.getActiveFaults(deviceId, now);
    const dupFault = faults.find(f => f.faultType === 'duplicate_delivery');
    if (dupFault) {
      dupFault.triggeredCount++;
    }
    return true;
  }

  hasStaleTelemetry(deviceId: string, now: number): boolean {
    return this.hasFault(deviceId, 'stale_telemetry', now);
  }

  getAllActiveFaults(now: number): Map<string, ActiveFault[]> {
    const result = new Map<string, ActiveFault[]>();
    for (const [deviceId, faults] of this.activeFaults) {
      const active = this.getActiveFaults(deviceId, now);
      if (active.length > 0) {
        result.set(deviceId, active);
      }
    }
    return result;
  }

  injectRandomOutage(
    devices: Device[],
    count: number,
    now: number,
    durationMs?: number
  ): string[] {
    const online = devices.filter(d => d.status === 'online');
    const shuffled = [...online];
    this.rng.shuffle(shuffled);
    const selected = shuffled.slice(0, count);
    
    for (const device of selected) {
      this.injectFault({ deviceId: device.id, faultType: 'offline', durationMs }, now);
    }
    
    return selected.map(d => d.id);
  }
}
