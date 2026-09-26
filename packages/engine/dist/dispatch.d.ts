import type { Dispatch, DispatchStatus } from './types.js';
export declare function createDispatch(targetKw: number, now: number): Dispatch;
export declare function updateDispatchAllocation(dispatch: Dispatch, allocatedKw: number, commandIds: string[]): Dispatch;
export declare function addDeliveredPower(dispatch: Dispatch, kw: number): Dispatch;
export declare function removeDeliveredPower(dispatch: Dispatch, kw: number): Dispatch;
export declare function setDispatchStatus(dispatch: Dispatch, status: DispatchStatus, now: number): Dispatch;
export declare function checkDispatchConvergence(dispatch: Dispatch): DispatchStatus;
//# sourceMappingURL=dispatch.d.ts.map