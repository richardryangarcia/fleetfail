import { v4 as uuid } from 'uuid';
export function createCommand(params) {
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
export function markSent(command, now) {
    return {
        ...command,
        status: 'sent',
        attemptCount: command.attemptCount + 1,
        lastAttemptAt: now,
    };
}
export function markAcked(command, now) {
    return {
        ...command,
        status: 'acked',
        ackedAt: now,
    };
}
export function markTimeout(command) {
    return { ...command, status: 'timeout' };
}
export function markStaleRejected(command) {
    return { ...command, status: 'stale_rejected' };
}
export function markDuplicateIgnored(command) {
    return { ...command, status: 'duplicate_ignored' };
}
export function markDeviceOffline(command) {
    return { ...command, status: 'device_offline' };
}
export function markExpired(command) {
    return { ...command, status: 'expired' };
}
export function isCommandExpired(command, now) {
    return now >= command.expiresAt;
}
export function shouldRetry(command, maxRetries) {
    return (command.status === 'timeout' &&
        command.attemptCount < maxRetries);
}
export function validateCommand(command, device, now) {
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
export function applyCommandToDevice(command, device) {
    const newKeys = new Set(device.processedKeys);
    newKeys.add(command.idempotencyKey);
    return {
        ...device,
        lastSequence: Math.max(device.lastSequence, command.sequence),
        processedKeys: newKeys,
    };
}
//# sourceMappingURL=command.js.map