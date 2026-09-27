import { Orchestrator, type FleetMetrics, type FleetEvent, type Device, type Command, type Dispatch, type ArbWindow, events } from '@fleetfail/engine';

const DEFAULT_DEVICE_COUNT = 20000;

let orchestrator: Orchestrator | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

export interface ArbModeState {
  armed: boolean;
  chargeWindow: ArbWindow | null;
  dischargeWindow: ArbWindow | null;
  spreadMwh: number;
  armedAt: number | null;
}

let arbModeState: ArbModeState = {
  armed: false,
  chargeWindow: null,
  dischargeWindow: null,
  spreadMwh: 0,
  armedAt: null,
};

export function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    orchestrator = new Orchestrator({
      seed: Date.now(),
      ackTimeoutMs: 3000,
      maxRetries: 3,
      commandExpiryMs: 30000,
      tickIntervalMs: 500,
      maxSendsPerTick: 2,
      maxAcksPerTick: 1,
    });
    orchestrator.seedFleet(DEFAULT_DEVICE_COUNT, Date.now());
  }
  return orchestrator;
}

export function resetOrchestrator(seed?: number, deviceCount: number = DEFAULT_DEVICE_COUNT): void {
  stopSimulation();
  disarmArbMode();
  orchestrator = new Orchestrator({
    seed: seed ?? Date.now(),
    ackTimeoutMs: 3000,
    maxRetries: 3,
    commandExpiryMs: 30000,
    tickIntervalMs: 500,
    maxSendsPerTick: 2,
    maxAcksPerTick: 1,
  });
  orchestrator.seedFleet(deviceCount, Date.now());
}

export function armArbMode(
  chargeWindow: ArbWindow | null, 
  dischargeWindow: ArbWindow | null, 
  spreadMwh: number
): ArbModeState {
  const orch = getOrchestrator();
  const timestamp = orch.getCurrentTime() || Date.now();
  
  arbModeState = {
    armed: true,
    chargeWindow,
    dischargeWindow,
    spreadMwh,
    armedAt: timestamp,
  };
  
  const arbArmedEvent = events.arbArmed(
    timestamp,
    chargeWindow?.hourEnding ?? 0,
    dischargeWindow?.hourEnding ?? 0,
    spreadMwh
  );
  orch.getState().events.push(arbArmedEvent);
  
  return arbModeState;
}

export function disarmArbMode(): ArbModeState {
  const wasArmed = arbModeState.armed;
  
  arbModeState = {
    armed: false,
    chargeWindow: null,
    dischargeWindow: null,
    spreadMwh: 0,
    armedAt: null,
  };
  
  if (wasArmed && orchestrator) {
    const timestamp = orchestrator.getCurrentTime() || Date.now();
    const arbDisarmedEvent = events.arbDisarmed(timestamp);
    orchestrator.getState().events.push(arbDisarmedEvent);
  }
  
  return arbModeState;
}

export function getArbModeState(): ArbModeState {
  return { ...arbModeState };
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
  arbMode: ArbModeState;
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
    arbMode: getArbModeState(),
  };
}

export function executeArbDispatch(
  targetKw: number, 
  windowType: 'charge' | 'discharge',
  priceMwh: number,
  hourEnding: number
): Dispatch | null {
  const orch = getOrchestrator();
  const timestamp = orch.getCurrentTime() || Date.now();
  
  const dispatch = orch.startDispatch(targetKw);
  startSimulation();
  
  if (windowType === 'charge') {
    const chargeEvent = events.arbChargeWindow(
      timestamp, 
      dispatch.id, 
      targetKw, 
      priceMwh, 
      hourEnding
    );
    orch.getState().events.push(chargeEvent);
  } else {
    const dischargeEvent = events.arbDischargeWindow(
      timestamp, 
      dispatch.id, 
      targetKw, 
      priceMwh, 
      hourEnding
    );
    orch.getState().events.push(dischargeEvent);
  }
  
  return dispatch;
}
