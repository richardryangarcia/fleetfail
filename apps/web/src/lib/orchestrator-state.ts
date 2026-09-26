import { Orchestrator, type FleetMetrics, type FleetEvent, type Device, type Command, type Dispatch } from '@fleetfail/engine';

const DEFAULT_DEVICE_COUNT = 20000;

let orchestrator: Orchestrator | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    orchestrator = new Orchestrator({
      seed: Date.now(),
      ackTimeoutMs: 3000,
      maxRetries: 3,
      commandExpiryMs: 30000,
      tickIntervalMs: 500,
    });
    orchestrator.seedFleet(DEFAULT_DEVICE_COUNT, Date.now());
  }
  return orchestrator;
}

export function resetOrchestrator(seed?: number, deviceCount: number = DEFAULT_DEVICE_COUNT): void {
  stopSimulation();
  orchestrator = new Orchestrator({
    seed: seed ?? Date.now(),
    ackTimeoutMs: 3000,
    maxRetries: 3,
    commandExpiryMs: 30000,
    tickIntervalMs: 500,
  });
  orchestrator.seedFleet(deviceCount, Date.now());
}

export function startSimulation(): void {
  if (isRunning) return;
  isRunning = true;
  
  const orch = getOrchestrator();
  tickInterval = setInterval(() => {
    orch.tick();
    
    const dispatch = orch.getActiveDispatch();
    if (dispatch && dispatch.status !== 'allocating' && dispatch.status !== 'executing') {
      stopSimulation();
    }
  }, 500);
}

export function stopSimulation(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  isRunning = false;
}

export function isSimulationRunning(): boolean {
  return isRunning;
}

export interface SimulationState {
  devices: Device[];
  metrics: FleetMetrics;
  events: FleetEvent[];
  commands: Command[];
  activeDispatch: Dispatch | null;
  isRunning: boolean;
  currentTime: number;
}

export function getSimulationState(): SimulationState {
  const orch = getOrchestrator();
  return {
    devices: orch.getDevices(),
    metrics: orch.getMetrics(),
    events: orch.getRecentEvents(100),
    commands: orch.getCommands(),
    activeDispatch: orch.getActiveDispatch() ?? null,
    isRunning,
    currentTime: orch.getCurrentTime(),
  };
}
