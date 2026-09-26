import { v4 as uuid } from 'uuid';
export function createEvent(type, timestamp, details = {}, ids = {}) {
    return {
        id: uuid(),
        type,
        timestamp,
        dispatchId: ids.dispatchId ?? null,
        deviceId: ids.deviceId ?? null,
        commandId: ids.commandId ?? null,
        details,
    };
}
export function commandSent(timestamp, dispatchId, deviceId, commandId, setpointKw) {
    return createEvent('COMMAND_SENT', timestamp, { setpointKw }, { dispatchId, deviceId, commandId });
}
export function ackTimeout(timestamp, dispatchId, deviceId, commandId, attemptCount) {
    return createEvent('ACK_TIMEOUT', timestamp, { attemptCount }, { dispatchId, deviceId, commandId });
}
export function retrySameId(timestamp, dispatchId, deviceId, commandId, idempotencyKey, attemptNumber) {
    return createEvent('RETRY_SAME_ID', timestamp, { idempotencyKey, attemptNumber }, { dispatchId, deviceId, commandId });
}
export function duplicateIgnored(timestamp, dispatchId, deviceId, commandId, idempotencyKey) {
    return createEvent('DUPLICATE_IGNORED', timestamp, { idempotencyKey }, { dispatchId, deviceId, commandId });
}
export function deviceExcluded(timestamp, dispatchId, deviceId, reason) {
    return createEvent('DEVICE_EXCLUDED', timestamp, { reason }, { dispatchId, deviceId });
}
export function reallocated(timestamp, dispatchId, fromDeviceId, toDeviceId, powerKw) {
    return createEvent('REALLOCATED', timestamp, { fromDeviceId, toDeviceId, powerKw }, { dispatchId });
}
export function staleRejected(timestamp, dispatchId, deviceId, commandId, commandEpoch, deviceEpoch) {
    return createEvent('STALE_REJECTED', timestamp, { commandEpoch, deviceEpoch }, { dispatchId, deviceId, commandId });
}
export function deviceOffline(timestamp, deviceId) {
    return createEvent('DEVICE_OFFLINE', timestamp, {}, { deviceId });
}
export function deviceOnline(timestamp, deviceId) {
    return createEvent('DEVICE_ONLINE', timestamp, {}, { deviceId });
}
export function deviceReconnected(timestamp, deviceId, newEpoch) {
    return createEvent('DEVICE_RECONNECTED', timestamp, { newEpoch }, { deviceId });
}
export function dispatchStarted(timestamp, dispatchId, targetKw, deviceCount) {
    return createEvent('DISPATCH_STARTED', timestamp, { targetKw, deviceCount }, { dispatchId });
}
export function dispatchConverged(timestamp, dispatchId, deliveredKw) {
    return createEvent('DISPATCH_CONVERGED', timestamp, { deliveredKw }, { dispatchId });
}
export function dispatchPartial(timestamp, dispatchId, targetKw, deliveredKw) {
    return createEvent('DISPATCH_PARTIAL', timestamp, { targetKw, deliveredKw }, { dispatchId });
}
export function dispatchInsufficient(timestamp, dispatchId, targetKw, availableKw) {
    return createEvent('DISPATCH_INSUFFICIENT', timestamp, { targetKw, availableKw }, { dispatchId });
}
export function commandAcked(timestamp, dispatchId, deviceId, commandId, setpointKw) {
    return createEvent('COMMAND_ACKED', timestamp, { setpointKw }, { dispatchId, deviceId, commandId });
}
export function commandExpired(timestamp, dispatchId, deviceId, commandId) {
    return createEvent('COMMAND_EXPIRED', timestamp, {}, { dispatchId, deviceId, commandId });
}
//# sourceMappingURL=event.js.map