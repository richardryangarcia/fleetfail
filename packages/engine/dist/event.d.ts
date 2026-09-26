import type { EventType, FleetEvent } from './types.js';
export declare function createEvent(type: EventType, timestamp: number, details?: Record<string, unknown>, ids?: {
    dispatchId?: string | null;
    deviceId?: string | null;
    commandId?: string | null;
}): FleetEvent;
export declare function commandSent(timestamp: number, dispatchId: string, deviceId: string, commandId: string, setpointKw: number): FleetEvent;
export declare function ackTimeout(timestamp: number, dispatchId: string, deviceId: string, commandId: string, attemptCount: number): FleetEvent;
export declare function retrySameId(timestamp: number, dispatchId: string, deviceId: string, commandId: string, idempotencyKey: string, attemptNumber: number): FleetEvent;
export declare function duplicateIgnored(timestamp: number, dispatchId: string, deviceId: string, commandId: string, idempotencyKey: string): FleetEvent;
export declare function deviceExcluded(timestamp: number, dispatchId: string, deviceId: string, reason: string): FleetEvent;
export declare function reallocated(timestamp: number, dispatchId: string, fromDeviceId: string, toDeviceId: string, powerKw: number): FleetEvent;
export declare function staleRejected(timestamp: number, dispatchId: string, deviceId: string, commandId: string, commandEpoch: number, deviceEpoch: number): FleetEvent;
export declare function deviceOffline(timestamp: number, deviceId: string): FleetEvent;
export declare function deviceOnline(timestamp: number, deviceId: string): FleetEvent;
export declare function deviceReconnected(timestamp: number, deviceId: string, newEpoch: number): FleetEvent;
export declare function dispatchStarted(timestamp: number, dispatchId: string, targetKw: number, deviceCount: number): FleetEvent;
export declare function dispatchConverged(timestamp: number, dispatchId: string, deliveredKw: number): FleetEvent;
export declare function dispatchPartial(timestamp: number, dispatchId: string, targetKw: number, deliveredKw: number): FleetEvent;
export declare function dispatchInsufficient(timestamp: number, dispatchId: string, targetKw: number, availableKw: number): FleetEvent;
export declare function commandAcked(timestamp: number, dispatchId: string, deviceId: string, commandId: string, setpointKw: number): FleetEvent;
export declare function commandExpired(timestamp: number, dispatchId: string, deviceId: string, commandId: string): FleetEvent;
//# sourceMappingURL=event.d.ts.map