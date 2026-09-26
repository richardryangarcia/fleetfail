import type { Command, Device } from './types.js';
export interface CreateCommandParams {
    deviceId: string;
    dispatchId: string;
    setpointKw: number;
    epoch: number;
    sequence: number;
    now: number;
    expiresAt: number;
}
export declare function createCommand(params: CreateCommandParams): Command;
export declare function markSent(command: Command, now: number): Command;
export declare function markAcked(command: Command, now: number): Command;
export declare function markTimeout(command: Command): Command;
export declare function markStaleRejected(command: Command): Command;
export declare function markDuplicateIgnored(command: Command): Command;
export declare function markDeviceOffline(command: Command): Command;
export declare function markExpired(command: Command): Command;
export declare function isCommandExpired(command: Command, now: number): boolean;
export declare function shouldRetry(command: Command, maxRetries: number): boolean;
/**
 * Validates command against device state for stale/duplicate detection
 */
export interface CommandValidation {
    valid: boolean;
    reason?: 'stale' | 'duplicate' | 'expired';
}
export declare function validateCommand(command: Command, device: Device, now: number): CommandValidation;
export declare function applyCommandToDevice(command: Command, device: Device): Device;
//# sourceMappingURL=command.d.ts.map