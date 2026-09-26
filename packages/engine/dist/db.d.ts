import type { Command, Dispatch, FleetEvent, Device } from './types.js';
export interface DbConfig {
    path: string;
    inMemory?: boolean;
}
export declare class FleetDb {
    private db;
    private writeQueue;
    private flushInterval;
    constructor(config?: DbConfig);
    private initSchema;
    saveDevice(device: Device): void;
    saveDevices(devices: Device[]): void;
    loadDevices(): Device[];
    saveCommand(command: Command): void;
    saveCommands(commands: Command[]): void;
    loadCommands(): Command[];
    saveDispatch(dispatch: Dispatch): void;
    loadDispatches(): Dispatch[];
    saveEvent(event: FleetEvent): void;
    saveEvents(evts: FleetEvent[]): void;
    loadEvents(limit?: number): FleetEvent[];
    getRecentEvents(count: number): FleetEvent[];
    queueWrite(fn: () => void): void;
    flush(): void;
    startWriteBehind(intervalMs?: number): void;
    stopWriteBehind(): void;
    clear(): void;
    close(): void;
}
//# sourceMappingURL=db.d.ts.map