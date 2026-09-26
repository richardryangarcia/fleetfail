import type { Device } from './types.js';
export type FaultType = 'offline' | 'lost_ack' | 'delayed_ack' | 'duplicate_delivery' | 'stale_telemetry';
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
export declare class FaultInjector {
    private activeFaults;
    private rng;
    constructor(seed: number);
    injectFault(fault: FaultConfig, now: number): ActiveFault;
    clearFault(deviceId: string, faultType: FaultType): void;
    clearAllFaults(deviceId: string): void;
    clearAllDeviceFaults(): void;
    getActiveFaults(deviceId: string, now: number): ActiveFault[];
    hasFault(deviceId: string, faultType: FaultType, now: number): boolean;
    isDeviceOffline(deviceId: string, now: number): boolean;
    shouldLoseAck(deviceId: string, now: number): boolean;
    shouldDelayAck(deviceId: string, now: number): boolean;
    shouldDuplicateDelivery(deviceId: string, now: number): boolean;
    hasStaleTelemetry(deviceId: string, now: number): boolean;
    getAllActiveFaults(now: number): Map<string, ActiveFault[]>;
    injectRandomOutage(devices: Device[], count: number, now: number, durationMs?: number): string[];
}
//# sourceMappingURL=fault-injection.d.ts.map