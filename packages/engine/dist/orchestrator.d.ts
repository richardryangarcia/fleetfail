import type { Command, Device, Dispatch, FleetEvent, FleetMetrics, OrchestratorConfig } from './types.js';
import { type FaultConfig, type ActiveFault } from './fault-injection.js';
export interface OrchestratorState {
    devices: Map<string, Device>;
    commands: Map<string, Command>;
    dispatches: Map<string, Dispatch>;
    events: FleetEvent[];
    currentTime: number;
    activeDispatchId: string | null;
}
export interface DeliveryResult {
    commandId: string;
    delivered: boolean;
    duplicate: boolean;
    stale: boolean;
    expired: boolean;
}
export declare class Orchestrator {
    private state;
    private config;
    private faultInjector;
    private rng;
    private sequenceCounter;
    private metrics;
    constructor(config?: Partial<OrchestratorConfig>);
    seedFleet(count: number, startTime?: number): void;
    getState(): OrchestratorState;
    getDevices(): Device[];
    getDevice(id: string): Device | undefined;
    getCommands(): Command[];
    getDispatches(): Dispatch[];
    getActiveDispatch(): Dispatch | undefined;
    getEvents(): FleetEvent[];
    getRecentEvents(count: number): FleetEvent[];
    getCurrentTime(): number;
    setTime(time: number): void;
    advanceTime(deltaMs: number): void;
    private emitEvent;
    private getNextSequence;
    injectFault(fault: FaultConfig): ActiveFault;
    clearFault(deviceId: string, faultType: FaultConfig['faultType']): void;
    restoreDevice(deviceId: string): void;
    getMetrics(): FleetMetrics;
    private calculateAvailableCapacity;
    startDispatch(targetKw: number): Dispatch;
    private allocateDispatch;
    sendPendingCommands(): void;
    simulateDelivery(commandId: string): DeliveryResult;
    simulateAck(commandId: string): boolean;
    checkTimeouts(): string[];
    retryTimedOutCommands(): string[];
    reallocateFailedCommands(): string[];
    checkDispatchCompletion(): boolean;
    tick(): void;
    runUntilComplete(maxTicks?: number): number;
    reset(): void;
}
//# sourceMappingURL=orchestrator.d.ts.map