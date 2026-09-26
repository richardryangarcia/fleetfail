import type {
  Command,
  Device,
  Dispatch,
  FleetEvent,
  FleetMetrics,
  OrchestratorConfig,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { seedFleet, getAvailablePowerKw, setDeviceStatus } from './device.js';
import {
  createCommand,
  markSent,
  markAcked,
  markTimeout,
  markStaleRejected,
  markDuplicateIgnored,
  markDeviceOffline,
  markExpired,
  markReallocated,
  validateCommand,
  applyCommandToDevice,
  shouldRetry,
  isCommandExpired,
} from './command.js';
import {
  createDispatch,
  updateDispatchAllocation,
  addDeliveredPower,
  setDispatchStatus,
  checkDispatchConvergence,
} from './dispatch.js';
import * as events from './event.js';
import { FaultInjector, type FaultConfig, type ActiveFault } from './fault-injection.js';
import { SeededRandom } from './random.js';
import { sortDevicesByZonePreference, type ZonePreference } from './zone-allocator.js';

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

export class Orchestrator {
  private state: OrchestratorState;
  private config: OrchestratorConfig;
  private faultInjector: FaultInjector;
  private rng: SeededRandom;
  private sequenceCounter: Map<string, number> = new Map();
  private zonePreferences: ZonePreference[] = [];
  
  private metrics: {
    duplicatesIgnored: number;
    staleRejected: number;
    reallocations: number;
    commandsSent: number;
    commandsAcked: number;
    commandsTimedOut: number;
  } = {
    duplicatesIgnored: 0,
    staleRejected: 0,
    reallocations: 0,
    commandsSent: 0,
    commandsAcked: 0,
    commandsTimedOut: 0,
  };

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.faultInjector = new FaultInjector(this.config.seed);
    this.rng = new SeededRandom(this.config.seed);
    
    this.state = {
      devices: new Map(),
      commands: new Map(),
      dispatches: new Map(),
      events: [],
      currentTime: 0,
      activeDispatchId: null,
    };
  }

  setZonePreferences(preferences: ZonePreference[]): void {
    this.zonePreferences = preferences;
  }

  getZonePreferences(): ZonePreference[] {
    return [...this.zonePreferences];
  }

  seedFleet(count: number, startTime: number = 0): void {
    this.state.currentTime = startTime;
    const devices = seedFleet(count, this.config.seed, startTime);
    for (const device of devices) {
      this.state.devices.set(device.id, device);
    }
  }

  getState(): OrchestratorState {
    return this.state;
  }

  getDevices(): Device[] {
    return Array.from(this.state.devices.values());
  }

  getDevice(id: string): Device | undefined {
    return this.state.devices.get(id);
  }

  getCommands(): Command[] {
    return Array.from(this.state.commands.values());
  }

  getDispatches(): Dispatch[] {
    return Array.from(this.state.dispatches.values());
  }

  getActiveDispatch(): Dispatch | undefined {
    if (!this.state.activeDispatchId) return undefined;
    return this.state.dispatches.get(this.state.activeDispatchId);
  }

  getEvents(): FleetEvent[] {
    return [...this.state.events];
  }

  getRecentEvents(count: number): FleetEvent[] {
    return this.state.events.slice(-count);
  }

  getCurrentTime(): number {
    return this.state.currentTime;
  }

  setTime(time: number): void {
    this.state.currentTime = time;
  }

  advanceTime(deltaMs: number): void {
    this.state.currentTime += deltaMs;
  }

  private emitEvent(event: FleetEvent): void {
    this.state.events.push(event);
  }

  private getNextSequence(dispatchId: string): number {
    const current = this.sequenceCounter.get(dispatchId) ?? 0;
    const next = current + 1;
    this.sequenceCounter.set(dispatchId, next);
    return next;
  }

  injectFault(fault: FaultConfig): ActiveFault {
    const active = this.faultInjector.injectFault(fault, this.state.currentTime);
    
    if (fault.faultType === 'offline') {
      const device = this.state.devices.get(fault.deviceId);
      if (device) {
        const updated = { ...setDeviceStatus(device, 'offline', this.state.currentTime), currentSetpointKw: 0 };
        this.state.devices.set(fault.deviceId, updated);
        this.emitEvent(events.deviceOffline(this.state.currentTime, fault.deviceId));
      }
    }
    
    return active;
  }

  clearFault(deviceId: string, faultType: FaultConfig['faultType']): void {
    this.faultInjector.clearFault(deviceId, faultType);
    
    if (faultType === 'offline') {
      const device = this.state.devices.get(deviceId);
      if (device && device.status === 'offline') {
        const updated = setDeviceStatus(device, 'online', this.state.currentTime);
        this.state.devices.set(deviceId, updated);
        this.emitEvent(events.deviceReconnected(this.state.currentTime, deviceId, updated.epoch));
      }
    }
  }

  restoreDevice(deviceId: string): void {
    this.faultInjector.clearAllFaults(deviceId);
    const device = this.state.devices.get(deviceId);
    if (device && device.status !== 'online') {
      const updated = setDeviceStatus(device, 'online', this.state.currentTime);
      this.state.devices.set(deviceId, updated);
      this.emitEvent(events.deviceReconnected(this.state.currentTime, deviceId, updated.epoch));
    }
  }

  getMetrics(): FleetMetrics {
    const devices = this.getDevices();
    const online = devices.filter(d => d.status === 'online');
    const offline = devices.filter(d => d.status !== 'online');
    
    const totalCapacityKw = devices.reduce((sum, d) => sum + d.maxPowerKw, 0);
    const availableCapacityKw = online.reduce((sum, d) => sum + getAvailablePowerKw(d), 0);
    const reserveBlockedKw = devices.reduce((sum, d) => {
      const blocked = d.maxPowerKw - getAvailablePowerKw(d);
      return sum + Math.max(0, blocked);
    }, 0);
    
    const activeDispatch = this.getActiveDispatch();
    const pendingCommands = this.getCommands().filter(
      c => c.status === 'pending' || c.status === 'sent' || c.status === 'timeout'
    );
    
    return {
      totalCapacityKw,
      availableCapacityKw,
      reserveBlockedKw,
      devicesOnline: online.length,
      devicesOffline: offline.length,
      totalDevices: devices.length,
      dispatchTargetKw: activeDispatch?.targetKw ?? 0,
      deliveredKw: activeDispatch?.deliveredKw ?? 0,
      pendingCommands: pendingCommands.length,
      timedOutCommands: this.metrics.commandsTimedOut,
      duplicatesIgnored: this.metrics.duplicatesIgnored,
      staleRejected: this.metrics.staleRejected,
      reallocations: this.metrics.reallocations,
    };
  }

  private calculateAvailableCapacity(): number {
    return this.getDevices()
      .filter(d => d.status === 'online')
      .reduce((sum, d) => sum + getAvailablePowerKw(d), 0);
  }

  startDispatch(targetKw: number): Dispatch {
    const dispatch = createDispatch(targetKw, this.state.currentTime);
    this.state.dispatches.set(dispatch.id, dispatch);
    this.state.activeDispatchId = dispatch.id;
    
    const availableCapacity = this.calculateAvailableCapacity();
    
    if (targetKw > availableCapacity) {
      this.emitEvent(events.dispatchInsufficient(
        this.state.currentTime,
        dispatch.id,
        targetKw,
        availableCapacity
      ));
      const updated = setDispatchStatus(dispatch, 'insufficient_capacity', this.state.currentTime);
      this.state.dispatches.set(dispatch.id, updated);
      return updated;
    }
    
    const allocation = this.allocateDispatch(dispatch, targetKw);
    this.emitEvent(events.dispatchStarted(
      this.state.currentTime,
      dispatch.id,
      targetKw,
      allocation.deviceCount
    ));
    
    return this.state.dispatches.get(dispatch.id)!;
  }

  private allocateDispatch(
    dispatch: Dispatch,
    targetKw: number,
    excludeDevices: Set<string> = new Set()
  ): { allocatedKw: number; commandIds: string[]; deviceCount: number } {
    let onlineDevices = this.getDevices()
      .filter(d => d.status === 'online' && !excludeDevices.has(d.id));
    
    if (this.zonePreferences.length > 0) {
      onlineDevices = sortDevicesByZonePreference(onlineDevices, this.zonePreferences);
    } else {
      onlineDevices = onlineDevices.sort((a, b) => getAvailablePowerKw(b) - getAvailablePowerKw(a));
    }
    
    let remaining = targetKw;
    const commandIds: string[] = [];
    let allocatedKw = 0;
    
    for (const device of onlineDevices) {
      if (remaining <= 0) break;
      
      const available = getAvailablePowerKw(device);
      if (available <= 0) {
        this.emitEvent(events.deviceExcluded(
          this.state.currentTime,
          dispatch.id,
          device.id,
          'insufficient_available_power'
        ));
        continue;
      }
      
      const setpoint = Math.min(available, remaining);
      const command = createCommand({
        deviceId: device.id,
        dispatchId: dispatch.id,
        setpointKw: setpoint,
        epoch: device.epoch,
        sequence: this.getNextSequence(dispatch.id),
        now: this.state.currentTime,
        expiresAt: this.state.currentTime + this.config.commandExpiryMs,
      });
      
      this.state.commands.set(command.id, command);
      commandIds.push(command.id);
      allocatedKw += setpoint;
      remaining -= setpoint;
    }
    
    const updated = updateDispatchAllocation(dispatch, allocatedKw, commandIds);
    this.state.dispatches.set(dispatch.id, updated);
    
    return { allocatedKw, commandIds, deviceCount: commandIds.length };
  }

  sendPendingCommands(): void {
    const dispatch = this.getActiveDispatch();
    if (!dispatch) return;
    
    for (const commandId of dispatch.commandIds) {
      const command = this.state.commands.get(commandId);
      if (!command || command.status !== 'pending') continue;
      
      const device = this.state.devices.get(command.deviceId);
      if (!device) continue;
      
      if (device.status !== 'online') {
        const updated = markDeviceOffline(command);
        this.state.commands.set(commandId, updated);
        continue;
      }
      
      const sent = markSent(command, this.state.currentTime);
      this.state.commands.set(commandId, sent);
      this.metrics.commandsSent++;
      
      this.emitEvent(events.commandSent(
        this.state.currentTime,
        dispatch.id,
        command.deviceId,
        commandId,
        command.setpointKw
      ));
    }
  }

  simulateDelivery(commandId: string): DeliveryResult {
    const command = this.state.commands.get(commandId);
    if (!command) {
      return { commandId, delivered: false, duplicate: false, stale: false, expired: false };
    }
    
    const device = this.state.devices.get(command.deviceId);
    if (!device) {
      return { commandId, delivered: false, duplicate: false, stale: false, expired: false };
    }
    
    if (isCommandExpired(command, this.state.currentTime)) {
      const updated = markExpired(command);
      this.state.commands.set(commandId, updated);
      this.emitEvent(events.commandExpired(
        this.state.currentTime,
        command.dispatchId,
        command.deviceId,
        commandId
      ));
      return { commandId, delivered: false, duplicate: false, stale: false, expired: true };
    }
    
    const validation = validateCommand(command, device, this.state.currentTime);
    
    if (!validation.valid) {
      if (validation.reason === 'duplicate') {
        const updated = markDuplicateIgnored(command);
        this.state.commands.set(commandId, updated);
        this.metrics.duplicatesIgnored++;
        this.emitEvent(events.duplicateIgnored(
          this.state.currentTime,
          command.dispatchId,
          command.deviceId,
          commandId,
          command.idempotencyKey
        ));
        return { commandId, delivered: false, duplicate: true, stale: false, expired: false };
      }
      
      if (validation.reason === 'stale') {
        const updated = markStaleRejected(command);
        this.state.commands.set(commandId, updated);
        this.metrics.staleRejected++;
        this.emitEvent(events.staleRejected(
          this.state.currentTime,
          command.dispatchId,
          command.deviceId,
          commandId,
          command.epoch,
          device.epoch
        ));
        return { commandId, delivered: false, duplicate: false, stale: true, expired: false };
      }
      
      if (validation.reason === 'expired') {
        const updated = markExpired(command);
        this.state.commands.set(commandId, updated);
        return { commandId, delivered: false, duplicate: false, stale: false, expired: true };
      }
    }
    
    const updatedDevice = applyCommandToDevice(command, device);
    this.state.devices.set(device.id, updatedDevice);
    
    return { commandId, delivered: true, duplicate: false, stale: false, expired: false };
  }

  simulateAck(commandId: string): boolean {
    const command = this.state.commands.get(commandId);
    if (!command || command.status !== 'sent') return false;
    
    const device = this.state.devices.get(command.deviceId);
    if (!device || device.status !== 'online') return false;
    
    if (this.faultInjector.shouldLoseAck(device.id, this.state.currentTime)) {
      return false;
    }
    
    const delivery = this.simulateDelivery(commandId);
    
    if (!delivery.delivered) {
      return false;
    }
    
    const updated = markAcked(command, this.state.currentTime);
    this.state.commands.set(commandId, updated);
    this.metrics.commandsAcked++;
    
    const updatedDevice = { ...this.state.devices.get(command.deviceId)!, currentSetpointKw: command.setpointKw };
    this.state.devices.set(command.deviceId, updatedDevice);
    
    this.emitEvent(events.commandAcked(
      this.state.currentTime,
      command.dispatchId,
      command.deviceId,
      commandId,
      command.setpointKw
    ));
    
    const dispatch = this.state.dispatches.get(command.dispatchId);
    if (dispatch) {
      const updatedDispatch = addDeliveredPower(dispatch, command.setpointKw);
      this.state.dispatches.set(dispatch.id, updatedDispatch);
    }
    
    return true;
  }

  checkTimeouts(): string[] {
    const timedOut: string[] = [];
    const now = this.state.currentTime;
    
    for (const command of this.state.commands.values()) {
      if (command.status !== 'sent') continue;
      if (!command.lastAttemptAt) continue;
      
      if (now - command.lastAttemptAt >= this.config.ackTimeoutMs) {
        const updated = markTimeout(command);
        this.state.commands.set(command.id, updated);
        this.metrics.commandsTimedOut++;
        timedOut.push(command.id);
        
        this.emitEvent(events.ackTimeout(
          now,
          command.dispatchId,
          command.deviceId,
          command.id,
          command.attemptCount
        ));
      }
    }
    
    return timedOut;
  }

  retryTimedOutCommands(): string[] {
    const retried: string[] = [];
    
    for (const command of this.state.commands.values()) {
      if (!shouldRetry(command, this.config.maxRetries)) continue;
      
      const device = this.state.devices.get(command.deviceId);
      if (!device || device.status !== 'online') continue;
      
      const sent = markSent(command, this.state.currentTime);
      this.state.commands.set(command.id, sent);
      this.metrics.commandsSent++;
      retried.push(command.id);
      
      this.emitEvent(events.retrySameId(
        this.state.currentTime,
        command.dispatchId,
        command.deviceId,
        command.id,
        command.idempotencyKey,
        sent.attemptCount
      ));
    }
    
    return retried;
  }

  reallocateFailedCommands(): string[] {
    const dispatch = this.getActiveDispatch();
    if (!dispatch) return [];
    
    const reallocated: string[] = [];
    const excludeDevices = new Set<string>();
    
    for (const commandId of dispatch.commandIds) {
      const command = this.state.commands.get(commandId);
      if (!command) continue;
      
      const needsReallocation = 
        command.status === 'device_offline' ||
        command.status === 'stale_rejected' ||
        (command.status === 'timeout' && command.attemptCount >= this.config.maxRetries);
      
      if (!needsReallocation) continue;
      
      const oldCommand = markReallocated(command);
      this.state.commands.set(commandId, oldCommand);
      
      excludeDevices.add(command.deviceId);
      
      const available = this.getDevices()
        .filter(d => d.status === 'online' && !excludeDevices.has(d.id))
        .sort((a, b) => getAvailablePowerKw(b) - getAvailablePowerKw(a));
      
      for (const device of available) {
        const capacity = getAvailablePowerKw(device);
        if (capacity <= 0) continue;
        
        const setpoint = Math.min(capacity, command.setpointKw);
        const newCommand = createCommand({
          deviceId: device.id,
          dispatchId: dispatch.id,
          setpointKw: setpoint,
          epoch: device.epoch,
          sequence: this.getNextSequence(dispatch.id),
          now: this.state.currentTime,
          expiresAt: this.state.currentTime + this.config.commandExpiryMs,
        });
        
        this.state.commands.set(newCommand.id, newCommand);
        
        const updatedDispatch = this.state.dispatches.get(dispatch.id)!;
        updatedDispatch.commandIds.push(newCommand.id);
        this.state.dispatches.set(dispatch.id, updatedDispatch);
        
        excludeDevices.add(device.id);
        this.metrics.reallocations++;
        reallocated.push(newCommand.id);
        
        this.emitEvent(events.reallocated(
          this.state.currentTime,
          dispatch.id,
          command.deviceId,
          device.id,
          setpoint
        ));
        
        break;
      }
    }
    
    return reallocated;
  }

  checkDispatchCompletion(): boolean {
    const dispatch = this.getActiveDispatch();
    if (!dispatch || dispatch.status !== 'executing') return false;
    
    const pendingCommands = dispatch.commandIds
      .map(id => this.state.commands.get(id))
      .filter(c => {
        if (!c) return false;
        if (c.status === 'pending' || c.status === 'sent') return true;
        if (c.status === 'timeout' && c.attemptCount < this.config.maxRetries) return true;
        return false;
      });
    
    if (pendingCommands.length > 0) return false;
    
    const status = checkDispatchConvergence(dispatch);
    const updated = setDispatchStatus(dispatch, status, this.state.currentTime);
    this.state.dispatches.set(dispatch.id, updated);
    
    if (status === 'converged') {
      this.emitEvent(events.dispatchConverged(
        this.state.currentTime,
        dispatch.id,
        dispatch.deliveredKw
      ));
    } else if (status === 'partial') {
      this.emitEvent(events.dispatchPartial(
        this.state.currentTime,
        dispatch.id,
        dispatch.targetKw,
        dispatch.deliveredKw
      ));
    }
    
    for (const device of this.state.devices.values()) {
      if (device.currentSetpointKw > 0) {
        const resetDevice = { ...device, currentSetpointKw: 0 };
        this.state.devices.set(device.id, resetDevice);
      }
    }
    
    return true;
  }

  tick(): void {
    this.advanceTime(this.config.tickIntervalMs);
    
    this.checkTimeouts();
    this.retryTimedOutCommands();
    
    this.sendPendingCommands();
    
    for (const command of this.state.commands.values()) {
      if (command.status === 'sent' && command.lastAttemptAt !== null) {
        const timeSinceSent = this.state.currentTime - command.lastAttemptAt;
        if (timeSinceSent >= this.config.tickIntervalMs) {
          const device = this.state.devices.get(command.deviceId);
          if (device && device.status === 'online' && 
              !this.faultInjector.shouldLoseAck(device.id, this.state.currentTime)) {
            this.simulateAck(command.id);
          }
        }
      }
    }
    
    this.reallocateFailedCommands();
    this.checkDispatchCompletion();
  }

  runUntilComplete(maxTicks: number = 100): number {
    let ticks = 0;
    
    while (ticks < maxTicks) {
      this.tick();
      ticks++;
      
      const dispatch = this.getActiveDispatch();
      if (dispatch && dispatch.status !== 'allocating' && dispatch.status !== 'executing') {
        break;
      }
    }
    
    return ticks;
  }

  reset(): void {
    this.state = {
      devices: new Map(),
      commands: new Map(),
      dispatches: new Map(),
      events: [],
      currentTime: 0,
      activeDispatchId: null,
    };
    this.metrics = {
      duplicatesIgnored: 0,
      staleRejected: 0,
      reallocations: 0,
      commandsSent: 0,
      commandsAcked: 0,
      commandsTimedOut: 0,
    };
    this.sequenceCounter.clear();
    this.faultInjector.clearAllDeviceFaults();
  }
}
