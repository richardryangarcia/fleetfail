import { v4 as uuid } from 'uuid';
import type { Dispatch, DispatchStatus } from './types.js';

export function createDispatch(targetKw: number, now: number): Dispatch {
  return {
    id: uuid(),
    targetKw,
    allocatedKw: 0,
    deliveredKw: 0,
    createdAt: now,
    completedAt: null,
    status: 'allocating',
    commandIds: [],
  };
}

export function updateDispatchAllocation(
  dispatch: Dispatch,
  allocatedKw: number,
  commandIds: string[]
): Dispatch {
  return {
    ...dispatch,
    allocatedKw,
    commandIds,
    status: 'executing',
  };
}

export function addDeliveredPower(dispatch: Dispatch, kw: number): Dispatch {
  return {
    ...dispatch,
    deliveredKw: dispatch.deliveredKw + kw,
  };
}

export function removeDeliveredPower(dispatch: Dispatch, kw: number): Dispatch {
  return {
    ...dispatch,
    deliveredKw: Math.max(0, dispatch.deliveredKw - kw),
  };
}

export function setDispatchStatus(
  dispatch: Dispatch,
  status: DispatchStatus,
  now: number
): Dispatch {
  return {
    ...dispatch,
    status,
    completedAt: status === 'converged' || status === 'partial' || status === 'insufficient_capacity' || status === 'failed'
      ? now
      : dispatch.completedAt,
  };
}

export function checkDispatchConvergence(dispatch: Dispatch): DispatchStatus {
  const tolerance = 0.01;
  const ratio = dispatch.deliveredKw / dispatch.targetKw;
  
  if (ratio >= 1 - tolerance) {
    return 'converged';
  }
  
  if (ratio > 0) {
    return 'partial';
  }
  
  return 'failed';
}
