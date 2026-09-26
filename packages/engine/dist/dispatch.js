import { v4 as uuid } from 'uuid';
export function createDispatch(targetKw, now) {
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
export function updateDispatchAllocation(dispatch, allocatedKw, commandIds) {
    return {
        ...dispatch,
        allocatedKw,
        commandIds,
        status: 'executing',
    };
}
export function addDeliveredPower(dispatch, kw) {
    return {
        ...dispatch,
        deliveredKw: dispatch.deliveredKw + kw,
    };
}
export function removeDeliveredPower(dispatch, kw) {
    return {
        ...dispatch,
        deliveredKw: Math.max(0, dispatch.deliveredKw - kw),
    };
}
export function setDispatchStatus(dispatch, status, now) {
    return {
        ...dispatch,
        status,
        completedAt: status === 'converged' || status === 'partial' || status === 'insufficient_capacity' || status === 'failed'
            ? now
            : dispatch.completedAt,
    };
}
export function checkDispatchConvergence(dispatch) {
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
//# sourceMappingURL=dispatch.js.map