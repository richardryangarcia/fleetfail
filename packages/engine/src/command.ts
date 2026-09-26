import { v4 as uuid } from 'uuid';
import type { Command, CommandStatus, Device } from './types.js';

export interface CreateCommandParams {
  deviceId: string;
  dispatchId: string;
  setpointKw: number;
  epoch: number;
  sequence: number;
  now: number;
  expiresAt: number;
}

export function createCommand(params: CreateCommandParams): Command {
  const id = uuid();
  return {
    id,
    idempotencyKey: `${params.dispatchId}-${params.deviceId}-${params.epoch}-${params.sequence}`,
    deviceId: params.deviceId,
    dispatchId: params.dispatchId,
    setpointKw: params.setpointKw,
    epoch: params.epoch,
    sequence: params.sequence,
    expiresAt: params.expiresAt,
    createdAt: params.now,
    status: 'pending',
    attemptCount: 0,
    lastAttemptAt: null,
    ackedAt: null,
  };
}

export function markSent(command: Command, now: number): Command {
  return {
    ...command,
    status: 'sent',
    attemptCount: command.attemptCount + 1,
    lastAttemptAt: now,
  };
}

export function markAcked(command: Command, now: number): Command {
  return {
    ...command,
    status: 'acked',
    ackedAt: now,
  };
}

export function markTimeout(command: Command): Command {
  return { ...command, status: 'timeout' };
}

export function markStaleRejected(command: Command): Command {
  return { ...command, status: 'stale_rejected' };
}

export function markDuplicateIgnored(command: Command): Command {
  return { ...command, status: 'duplicate_ignored' };
}

export function markDeviceOffline(command: Command): Command {
  return { ...command, status: 'device_offline' };
}

export function markExpired(command: Command): Command {
  return { ...command, status: 'expired' };
}

export function markReallocated(command: Command): Command {
  return { ...command, status: 'reallocated' };
}

export function isCommandExpired(command: Command, now: number): boolean {
  return now >= command.expiresAt;
}

export function shouldRetry(command: Command, maxRetries: number): boolean {
  return (
    command.status === 'timeout' &&
    command.attemptCount < maxRetries
  );
}

/**
 * Validates command against device state for stale/duplicate detection
 */
export interface CommandValidation {
  valid: boolean;
  reason?: 'stale' | 'duplicate' | 'expired';
}

export function validateCommand(
  command: Command,
  device: Device,
  now: number
): CommandValidation {
  if (isCommandExpired(command, now)) {
    return { valid: false, reason: 'expired' };
  }
  
  if (device.processedKeys.has(command.idempotencyKey)) {
    return { valid: false, reason: 'duplicate' };
  }
  
  if (command.epoch < device.epoch) {
    return { valid: false, reason: 'stale' };
  }
  
  if (command.epoch === device.epoch && command.sequence <= device.lastSequence) {
    return { valid: false, reason: 'stale' };
  }
  
  return { valid: true };
}

export function applyCommandToDevice(command: Command, device: Device): Device {
  const newKeys = new Set(device.processedKeys);
  newKeys.add(command.idempotencyKey);
  
  return {
    ...device,
    lastSequence: Math.max(device.lastSequence, command.sequence),
    processedKeys: newKeys,
  };
}
