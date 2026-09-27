import { v4 as uuid } from 'uuid';
import type { EventType, FleetEvent } from './types.js';

export function createEvent(
  type: EventType,
  timestamp: number,
  details: Record<string, unknown> = {},
  ids: {
    dispatchId?: string | null;
    deviceId?: string | null;
    commandId?: string | null;
  } = {}
): FleetEvent {
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

export function commandSent(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string,
  setpointKw: number
): FleetEvent {
  return createEvent('COMMAND_SENT', timestamp, { setpointKw }, { dispatchId, deviceId, commandId });
}

export function ackTimeout(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string,
  attemptCount: number
): FleetEvent {
  return createEvent('ACK_TIMEOUT', timestamp, { attemptCount }, { dispatchId, deviceId, commandId });
}

export function retrySameId(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string,
  idempotencyKey: string,
  attemptNumber: number
): FleetEvent {
  return createEvent('RETRY_SAME_ID', timestamp, { idempotencyKey, attemptNumber }, { dispatchId, deviceId, commandId });
}

export function duplicateIgnored(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string,
  idempotencyKey: string
): FleetEvent {
  return createEvent('DUPLICATE_IGNORED', timestamp, { idempotencyKey }, { dispatchId, deviceId, commandId });
}

export function deviceExcluded(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  reason: string
): FleetEvent {
  return createEvent('DEVICE_EXCLUDED', timestamp, { reason }, { dispatchId, deviceId });
}

export function reallocated(
  timestamp: number,
  dispatchId: string,
  fromDeviceId: string,
  toDeviceId: string,
  powerKw: number
): FleetEvent {
  return createEvent('REALLOCATED', timestamp, { fromDeviceId, toDeviceId, powerKw }, { dispatchId });
}

export function staleRejected(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string,
  commandEpoch: number,
  deviceEpoch: number
): FleetEvent {
  return createEvent('STALE_REJECTED', timestamp, { commandEpoch, deviceEpoch }, { dispatchId, deviceId, commandId });
}

export function deviceOffline(timestamp: number, deviceId: string): FleetEvent {
  return createEvent('DEVICE_OFFLINE', timestamp, {}, { deviceId });
}

export function deviceOnline(timestamp: number, deviceId: string): FleetEvent {
  return createEvent('DEVICE_ONLINE', timestamp, {}, { deviceId });
}

export function deviceReconnected(
  timestamp: number,
  deviceId: string,
  newEpoch: number
): FleetEvent {
  return createEvent('DEVICE_RECONNECTED', timestamp, { newEpoch }, { deviceId });
}

export function dispatchStarted(
  timestamp: number,
  dispatchId: string,
  targetKw: number,
  deviceCount: number
): FleetEvent {
  return createEvent('DISPATCH_STARTED', timestamp, { targetKw, deviceCount }, { dispatchId });
}

export function dispatchConverged(
  timestamp: number,
  dispatchId: string,
  deliveredKw: number
): FleetEvent {
  return createEvent('DISPATCH_CONVERGED', timestamp, { deliveredKw }, { dispatchId });
}

export function dispatchPartial(
  timestamp: number,
  dispatchId: string,
  targetKw: number,
  deliveredKw: number
): FleetEvent {
  return createEvent('DISPATCH_PARTIAL', timestamp, { targetKw, deliveredKw }, { dispatchId });
}

export function dispatchInsufficient(
  timestamp: number,
  dispatchId: string,
  targetKw: number,
  availableKw: number
): FleetEvent {
  return createEvent('DISPATCH_INSUFFICIENT', timestamp, { targetKw, availableKw }, { dispatchId });
}

export function commandAcked(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string,
  setpointKw: number
): FleetEvent {
  return createEvent('COMMAND_ACKED', timestamp, { setpointKw }, { dispatchId, deviceId, commandId });
}

export function commandExpired(
  timestamp: number,
  dispatchId: string,
  deviceId: string,
  commandId: string
): FleetEvent {
  return createEvent('COMMAND_EXPIRED', timestamp, {}, { dispatchId, deviceId, commandId });
}

export function arbArmed(
  timestamp: number,
  chargeWindowHour: number,
  dischargeWindowHour: number,
  spreadMwh: number
): FleetEvent {
  return createEvent('ARB_ARMED', timestamp, { 
    chargeWindowHour, 
    dischargeWindowHour, 
    spreadMwh 
  }, {});
}

export function arbDisarmed(timestamp: number): FleetEvent {
  return createEvent('ARB_DISARMED', timestamp, {}, {});
}

export function arbChargeWindow(
  timestamp: number,
  dispatchId: string,
  targetKw: number,
  priceMwh: number,
  hourEnding: number
): FleetEvent {
  return createEvent('ARB_CHARGE_WINDOW', timestamp, { 
    targetKw, 
    priceMwh, 
    hourEnding 
  }, { dispatchId });
}

export function arbDischargeWindow(
  timestamp: number,
  dispatchId: string,
  targetKw: number,
  priceMwh: number,
  hourEnding: number
): FleetEvent {
  return createEvent('ARB_DISCHARGE_WINDOW', timestamp, { 
    targetKw, 
    priceMwh, 
    hourEnding 
  }, { dispatchId });
}
