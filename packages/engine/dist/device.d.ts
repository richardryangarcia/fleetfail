import type { Device, DeviceStatus } from './types.js';
import { SeededRandom } from './random.js';
export interface DeviceSpec {
    maxPowerKw: number;
    capacityKwh: number;
    socPercent: number;
    reservePercent: number;
    zone: string;
}
export declare function createDevice(spec: Partial<DeviceSpec> | undefined, rng: SeededRandom, now: number, nameIndex: number): Device;
export declare function seedFleet(count: number, seed: number, now: number): Device[];
export declare function getAvailablePowerKw(device: Device): number;
export declare function setDeviceStatus(device: Device, status: DeviceStatus, now: number): Device;
export declare function updateDeviceTelemetry(device: Device, now: number): Device;
export declare function isTelemetryFresh(device: Device, now: number, thresholdMs: number): boolean;
export declare function applyCommandEffect(device: Device, setpointKw: number, durationHours: number): Device;
//# sourceMappingURL=device.d.ts.map