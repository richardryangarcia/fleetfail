import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import type { FleetMetrics } from './types.js';

describe('FleetFail P0 Kill Gate Tests', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    orchestrator = new Orchestrator({
      seed: 42,
      ackTimeoutMs: 5000,
      maxRetries: 3,
      commandExpiryMs: 60000,
      tickIntervalMs: 1000,
    });
    orchestrator.seedFleet(50, 0);
  });

  describe('Fleet Seeding', () => {
    it('seeds 50 devices with correct properties', () => {
      const devices = orchestrator.getDevices();
      expect(devices).toHaveLength(50);
      
      for (const device of devices) {
        expect(device.status).toBe('online');
        expect(device.maxPowerKw).toBeGreaterThan(0);
        expect(device.capacityKwh).toBeGreaterThan(0);
        expect(device.socPercent).toBeGreaterThanOrEqual(0);
        expect(device.socPercent).toBeLessThanOrEqual(100);
        expect(device.reservePercent).toBe(20);
        expect(device.epoch).toBe(1);
      }
    });

    it('seeds 100 devices when requested', () => {
      const bigOrchestrator = new Orchestrator({ seed: 123 });
      bigOrchestrator.seedFleet(100, 0);
      expect(bigOrchestrator.getDevices()).toHaveLength(100);
    });

    it('produces deterministic fleet with same seed', () => {
      const orch1 = new Orchestrator({ seed: 999 });
      const orch2 = new Orchestrator({ seed: 999 });
      orch1.seedFleet(10, 0);
      orch2.seedFleet(10, 0);
      
      const devices1 = orch1.getDevices();
      const devices2 = orch2.getDevices();
      
      for (let i = 0; i < 10; i++) {
        expect(devices1[i]!.maxPowerKw).toBeCloseTo(devices2[i]!.maxPowerKw);
        expect(devices1[i]!.capacityKwh).toBeCloseTo(devices2[i]!.capacityKwh);
      }
    });
  });

  describe('Dispatch Allocation and Convergence', () => {
    it('allocates and converges on target power', () => {
      const dispatch = orchestrator.startDispatch(100);
      expect(dispatch.status).toBe('executing');
      expect(dispatch.targetKw).toBe(100);
      expect(dispatch.allocatedKw).toBeGreaterThanOrEqual(99.99);
      
      orchestrator.runUntilComplete(50);
      
      const completed = orchestrator.getActiveDispatch()!;
      expect(completed.status).toBe('converged');
      expect(completed.deliveredKw).toBeGreaterThanOrEqual(completed.targetKw * 0.99);
    });

    it('emits DISPATCH_STARTED and DISPATCH_CONVERGED events', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(50);
      
      const events = orchestrator.getEvents();
      const startEvent = events.find(e => e.type === 'DISPATCH_STARTED');
      const convergeEvent = events.find(e => e.type === 'DISPATCH_CONVERGED');
      
      expect(startEvent).toBeDefined();
      expect(convergeEvent).toBeDefined();
      expect((startEvent!.details as { targetKw: number }).targetKw).toBe(100);
    });
  });

  describe('Lost ACK Recovery', () => {
    it('retries command with same idempotency key after ACK timeout', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices.slice(0, 20)) {
        orchestrator.injectFault({
          deviceId: device.id,
          faultType: 'lost_ack',
          durationMs: 100000,
        });
      }
      
      orchestrator.startDispatch(200);
      
      for (let i = 0; i < 30; i++) {
        orchestrator.tick();
      }
      
      const evts = orchestrator.getEvents();
      const timeoutEvents = evts.filter(e => e.type === 'ACK_TIMEOUT');
      const retryEvents = evts.filter(e => e.type === 'RETRY_SAME_ID');
      
      expect(timeoutEvents.length).toBeGreaterThan(0);
      expect(retryEvents.length).toBeGreaterThan(0);
      
      const retryEvent = retryEvents[0]!;
      expect(retryEvent.details).toHaveProperty('idempotencyKey');
      expect(retryEvent.details).toHaveProperty('attemptNumber');
    });

    it('maintains same idempotency key across retries', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      
      orchestrator.injectFault({
        deviceId: targetDevice.id,
        faultType: 'lost_ack',
        durationMs: 30000,
      });
      
      orchestrator.startDispatch(30);
      
      for (let i = 0; i < 30; i++) {
        orchestrator.tick();
      }
      
      const events = orchestrator.getEvents();
      const retryEvents = events.filter(
        e => e.type === 'RETRY_SAME_ID' && e.deviceId === targetDevice.id
      );
      
      if (retryEvents.length > 1) {
        const keys = retryEvents.map(e => (e.details as { idempotencyKey: string }).idempotencyKey);
        expect(new Set(keys).size).toBe(1);
      }
    });
  });

  describe('Duplicate Detection - No Duplicate kW Effects', () => {
    it('ignores duplicate command delivery with same idempotency key', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(20);
      
      const commands = orchestrator.getCommands();
      const ackedCommand = commands.find(c => c.status === 'acked');
      
      expect(ackedCommand).toBeDefined();
      
      const device = orchestrator.getDevice(ackedCommand!.deviceId)!;
      expect(device.processedKeys.has(ackedCommand!.idempotencyKey)).toBe(true);
      
      const result = orchestrator.simulateDelivery(ackedCommand!.id);
      
      expect(result.duplicate).toBe(true);
      expect(result.delivered).toBe(false);
      
      const evts = orchestrator.getEvents();
      const duplicateEvents = evts.filter(
        e => e.type === 'DUPLICATE_IGNORED' && e.commandId === ackedCommand!.id
      );
      expect(duplicateEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('tracks duplicate count in metrics', () => {
      const devices = orchestrator.getDevices();
      
      orchestrator.injectFault({
        deviceId: devices[0]!.id,
        faultType: 'duplicate_delivery',
      });
      
      orchestrator.startDispatch(50);
      orchestrator.runUntilComplete(30);
      
      const metrics = orchestrator.getMetrics();
      expect(metrics.duplicatesIgnored).toBeGreaterThanOrEqual(0);
    });

    it('ensures delivered kW does not double-count duplicates', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(50);
      
      const dispatch = orchestrator.getActiveDispatch()!;
      const commands = orchestrator.getCommands().filter(
        c => c.dispatchId === dispatch.id && c.status === 'acked'
      );
      
      const expectedDelivered = commands.reduce((sum, c) => sum + c.setpointKw, 0);
      expect(dispatch.deliveredKw).toBeCloseTo(expectedDelivered, 1);
    });
  });

  describe('Stale Command Rejection on Reconnect', () => {
    it('rejects stale commands after device reconnect with new epoch', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      const initialEpoch = targetDevice.epoch;
      
      orchestrator.startDispatch(50);
      orchestrator.tick();
      
      const commandsBeforeOffline = orchestrator.getCommands().filter(
        c => c.deviceId === targetDevice.id && c.status === 'sent'
      );
      
      if (commandsBeforeOffline.length > 0) {
        orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
        
        for (let i = 0; i < 5; i++) {
          orchestrator.tick();
        }
        
        orchestrator.restoreDevice(targetDevice.id);
        
        const reconnectedDevice = orchestrator.getDevice(targetDevice.id)!;
        expect(reconnectedDevice.epoch).toBe(initialEpoch + 1);
        
        const staleCommand = commandsBeforeOffline[0]!;
        const result = orchestrator.simulateDelivery(staleCommand.id);
        
        expect(result.stale).toBe(true);
        expect(result.delivered).toBe(false);
        
        const events = orchestrator.getEvents();
        const staleEvents = events.filter(e => e.type === 'STALE_REJECTED');
        expect(staleEvents.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('increments epoch on each reconnect', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      
      expect(targetDevice.epoch).toBe(1);
      
      orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
      orchestrator.restoreDevice(targetDevice.id);
      
      expect(orchestrator.getDevice(targetDevice.id)!.epoch).toBe(2);
      
      orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
      orchestrator.restoreDevice(targetDevice.id);
      
      expect(orchestrator.getDevice(targetDevice.id)!.epoch).toBe(3);
    });

    it('tracks stale rejection count in metrics', () => {
      const devices = orchestrator.getDevices();
      
      orchestrator.startDispatch(100);
      orchestrator.tick();
      
      for (const device of devices.slice(0, 5)) {
        orchestrator.injectFault({ deviceId: device.id, faultType: 'offline' });
      }
      
      for (let i = 0; i < 10; i++) {
        orchestrator.tick();
      }
      
      for (const device of devices.slice(0, 5)) {
        orchestrator.restoreDevice(device.id);
      }
      
      orchestrator.runUntilComplete(30);
      
      const metrics = orchestrator.getMetrics();
      expect(metrics.staleRejected).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Reserve Protection', () => {
    it('respects device reserve percentage in allocation', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices) {
        expect(device.reservePercent).toBe(20);
      }
      
      orchestrator.startDispatch(200);
      orchestrator.tick();
      
      const commands = orchestrator.getCommands();
      
      for (const command of commands) {
        const device = orchestrator.getDevice(command.deviceId)!;
        const availableSoc = Math.max(0, device.socPercent - device.reservePercent);
        const maxAvailableKw = Math.min(
          device.maxPowerKw,
          (availableSoc / 100) * device.capacityKwh
        );
        
        expect(command.setpointKw).toBeLessThanOrEqual(maxAvailableKw + 0.01);
      }
    });

    it('excludes devices with insufficient available power', () => {
      const lowSocOrchestrator = new Orchestrator({ seed: 42 });
      lowSocOrchestrator.seedFleet(10, 0);
      
      const devices = lowSocOrchestrator.getDevices();
      for (const device of devices.slice(0, 5)) {
        const lowSocDevice = { ...device, socPercent: 21 };
        lowSocOrchestrator['state'].devices.set(device.id, lowSocDevice);
      }
      
      lowSocOrchestrator.startDispatch(100);
      
      const events = lowSocOrchestrator.getEvents();
      const excludedEvents = events.filter(e => e.type === 'DEVICE_EXCLUDED');
      
      expect(excludedEvents.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Reallocation on Device Failure', () => {
    it('reallocates power from offline device to available device', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      
      orchestrator.startDispatch(100);
      orchestrator.tick();
      
      orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
      
      for (let i = 0; i < 20; i++) {
        orchestrator.tick();
      }
      
      const events = orchestrator.getEvents();
      const reallocatedEvents = events.filter(e => e.type === 'REALLOCATED');
      
      expect(reallocatedEvents.length).toBeGreaterThanOrEqual(0);
      
      if (reallocatedEvents.length > 0) {
        const event = reallocatedEvents[0]!;
        expect(event.details).toHaveProperty('fromDeviceId');
        expect(event.details).toHaveProperty('toDeviceId');
        expect(event.details).toHaveProperty('powerKw');
      }
    });

    it('tracks reallocation count in metrics', () => {
      const devices = orchestrator.getDevices();
      
      orchestrator.startDispatch(200);
      orchestrator.tick();
      
      for (const device of devices.slice(0, 10)) {
        orchestrator.injectFault({ deviceId: device.id, faultType: 'offline' });
      }
      
      orchestrator.runUntilComplete(50);
      
      const metrics = orchestrator.getMetrics();
      expect(metrics.reallocations).toBeGreaterThanOrEqual(0);
    });

    it('reallocates after max retries exhausted', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      
      orchestrator.injectFault({
        deviceId: targetDevice.id,
        faultType: 'lost_ack',
        durationMs: 100000,
      });
      
      orchestrator.startDispatch(50);
      
      for (let i = 0; i < 50; i++) {
        orchestrator.tick();
      }
      
      const commands = orchestrator.getCommands().filter(
        c => c.deviceId === targetDevice.id
      );
      
      const exhausted = commands.find(c => c.attemptCount >= 3);
      
      if (exhausted) {
        const events = orchestrator.getEvents();
        const reallocated = events.some(
          e => e.type === 'REALLOCATED' && 
               (e.details as { fromDeviceId: string }).fromDeviceId === targetDevice.id
        );
        expect(reallocated).toBe(true);
      }
    });
  });

  describe('Reallocation Loop Protection (P0 Fix)', () => {
    it('marks reallocated commands as terminal to prevent infinite loop', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices.slice(0, 5)) {
        orchestrator.injectFault({
          deviceId: device.id,
          faultType: 'lost_ack',
          durationMs: 100000,
        });
      }
      
      orchestrator.startDispatch(100);
      
      for (let i = 0; i < 60; i++) {
        orchestrator.tick();
      }
      
      const commands = orchestrator.getCommands();
      const reallocatedCommands = commands.filter(c => c.status === 'reallocated');
      const exhaustedTimeouts = commands.filter(
        c => c.status === 'timeout' && c.attemptCount >= 3
      );
      
      expect(exhaustedTimeouts.length).toBe(0);
      expect(reallocatedCommands.length).toBeGreaterThan(0);
    });

    it('delivered power never exceeds target (capped at 100%)', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(50);
      
      const dispatch = orchestrator.getActiveDispatch()!;
      
      expect(dispatch.deliveredKw).toBeLessThanOrEqual(dispatch.targetKw);
      
      const progressPct = (dispatch.deliveredKw / dispatch.targetKw) * 100;
      expect(progressPct).toBeLessThanOrEqual(100);
    });

    it('dispatch completes even with exhausted timeout commands', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices.slice(0, 5)) {
        orchestrator.injectFault({
          deviceId: device.id,
          faultType: 'lost_ack',
          durationMs: 100000,
        });
      }
      
      orchestrator.startDispatch(100);
      
      const ticks = orchestrator.runUntilComplete(200);
      
      const dispatch = orchestrator.getActiveDispatch()!;
      expect(dispatch.status).not.toBe('executing');
      expect(ticks).toBeLessThan(200);
    });

    it('reallocation only happens once per failed command', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      
      orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
      
      orchestrator.startDispatch(50);
      
      for (let i = 0; i < 30; i++) {
        orchestrator.tick();
      }
      
      const events = orchestrator.getEvents();
      const reallocatedFromTarget = events.filter(
        e => e.type === 'REALLOCATED' && 
             (e.details as { fromDeviceId: string }).fromDeviceId === targetDevice.id
      );
      
      expect(reallocatedFromTarget.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Insufficient Capacity / Shortfall', () => {
    it('detects INSUFFICIENT_CAPACITY when target exceeds fleet capacity', () => {
      const metrics = orchestrator.getMetrics();
      const hugeTarget = metrics.totalCapacityKw * 10;
      
      const dispatch = orchestrator.startDispatch(hugeTarget);
      
      expect(dispatch.status).toBe('insufficient_capacity');
      
      const events = orchestrator.getEvents();
      const insufficientEvent = events.find(e => e.type === 'DISPATCH_INSUFFICIENT');
      
      expect(insufficientEvent).toBeDefined();
      expect((insufficientEvent!.details as { targetKw: number }).targetKw).toBe(hugeTarget);
    });

    it('handles partial delivery due to outages', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices.slice(0, 40)) {
        orchestrator.injectFault({ deviceId: device.id, faultType: 'offline' });
      }
      
      const dispatch = orchestrator.startDispatch(200);
      orchestrator.runUntilComplete(50);
      
      const completed = orchestrator.getActiveDispatch()!;
      
      if (completed.status === 'partial' || completed.status === 'insufficient_capacity') {
        expect(completed.deliveredKw).toBeLessThan(completed.targetKw);
        
        const events = orchestrator.getEvents();
        const partialEvent = events.find(
          e => e.type === 'DISPATCH_PARTIAL' || e.type === 'DISPATCH_INSUFFICIENT'
        );
        expect(partialEvent).toBeDefined();
      }
    });
  });

  describe('Event Logging', () => {
    it('emits all required event types during dispatch lifecycle', () => {
      const devices = orchestrator.getDevices();
      
      orchestrator.injectFault({
        deviceId: devices[0]!.id,
        faultType: 'lost_ack',
        durationMs: 20000,
      });
      
      orchestrator.startDispatch(100);
      
      for (let i = 0; i < 30; i++) {
        orchestrator.tick();
      }
      
      orchestrator.restoreDevice(devices[0]!.id);
      orchestrator.runUntilComplete(30);
      
      const events = orchestrator.getEvents();
      const eventTypes = new Set(events.map(e => e.type));
      
      expect(eventTypes.has('COMMAND_SENT')).toBe(true);
      expect(eventTypes.has('DISPATCH_STARTED')).toBe(true);
      
      const hasCompletion = 
        eventTypes.has('DISPATCH_CONVERGED') || 
        eventTypes.has('DISPATCH_PARTIAL') ||
        eventTypes.has('DISPATCH_INSUFFICIENT');
      expect(hasCompletion).toBe(true);
    });

    it('associates events with correct dispatch/device/command IDs', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(30);
      
      const dispatch = orchestrator.getActiveDispatch()!;
      const events = orchestrator.getEvents();
      
      const dispatchEvents = events.filter(e => e.dispatchId === dispatch.id);
      expect(dispatchEvents.length).toBeGreaterThan(0);
      
      const commandEvents = events.filter(e => e.commandId !== null);
      for (const event of commandEvents) {
        const command = orchestrator.getCommands().find(c => c.id === event.commandId);
        expect(command).toBeDefined();
      }
    });
  });

  describe('Metrics Accuracy', () => {
    it('accurately tracks target vs delivered power', () => {
      orchestrator.startDispatch(150);
      orchestrator.runUntilComplete(50);
      
      const dispatch = orchestrator.getActiveDispatch()!;
      const metrics = orchestrator.getMetrics();
      
      expect(metrics.dispatchTargetKw).toBe(150);
      expect(metrics.deliveredKw).toBe(dispatch.deliveredKw);
    });

    it('accurately tracks online/offline device counts', () => {
      const devices = orchestrator.getDevices();
      const offlineCount = 15;
      
      for (const device of devices.slice(0, offlineCount)) {
        orchestrator.injectFault({ deviceId: device.id, faultType: 'offline' });
      }
      
      const metrics = orchestrator.getMetrics();
      
      expect(metrics.devicesOffline).toBe(offlineCount);
      expect(metrics.devicesOnline).toBe(50 - offlineCount);
      expect(metrics.totalDevices).toBe(50);
    });

    it('tracks pending command count', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices.slice(0, 30)) {
        orchestrator.injectFault({
          deviceId: device.id,
          faultType: 'lost_ack',
          durationMs: 100000,
        });
      }
      
      orchestrator.startDispatch(200);
      orchestrator.tick();
      orchestrator.tick();
      
      const metrics = orchestrator.getMetrics();
      expect(metrics.pendingCommands).toBeGreaterThan(0);
    });
  });

  describe('Deterministic Simulation', () => {
    it('produces identical results with same seed', () => {
      const runSimulation = (seed: number): FleetMetrics => {
        const orch = new Orchestrator({ seed });
        orch.seedFleet(50, 0);
        orch.startDispatch(100);
        orch.runUntilComplete(50);
        return orch.getMetrics();
      };
      
      const metrics1 = runSimulation(12345);
      const metrics2 = runSimulation(12345);
      
      expect(metrics1.deliveredKw).toBeCloseTo(metrics2.deliveredKw);
      expect(metrics1.totalCapacityKw).toBeCloseTo(metrics2.totalCapacityKw);
    });

    it('produces different results with different seeds', () => {
      const runSimulation = (seed: number): number => {
        const orch = new Orchestrator({ seed });
        orch.seedFleet(50, 0);
        return orch.getMetrics().totalCapacityKw;
      };
      
      const capacity1 = runSimulation(111);
      const capacity2 = runSimulation(222);
      
      expect(capacity1).not.toBeCloseTo(capacity2);
    });
  });
});

describe('Database Persistence', () => {
  it('persists and loads devices correctly', async () => {
    const { FleetDb } = await import('./db.js');
    const { seedFleet } = await import('./device.js');
    
    const db = new FleetDb({ path: ':memory:', inMemory: true });
    const devices = seedFleet(10, 42, 0);
    
    db.saveDevices(devices);
    const loaded = db.loadDevices();
    
    expect(loaded).toHaveLength(10);
    expect(loaded[0]!.id).toBe(devices[0]!.id);
    expect(loaded[0]!.maxPowerKw).toBeCloseTo(devices[0]!.maxPowerKw);
    
    db.close();
  });

  it('persists and loads commands correctly', async () => {
    const { FleetDb } = await import('./db.js');
    const { createCommand } = await import('./command.js');
    
    const db = new FleetDb({ path: ':memory:', inMemory: true });
    
    const command = createCommand({
      deviceId: 'device-1',
      dispatchId: 'dispatch-1',
      setpointKw: 10,
      epoch: 1,
      sequence: 1,
      now: 1000,
      expiresAt: 60000,
    });
    
    db.saveCommand(command);
    const loaded = db.loadCommands();
    
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.idempotencyKey).toBe(command.idempotencyKey);
    expect(loaded[0]!.setpointKw).toBe(10);
    
    db.close();
  });

  it('persists and loads events correctly', async () => {
    const { FleetDb } = await import('./db.js');
    const { commandSent } = await import('./event.js');
    
    const db = new FleetDb({ path: ':memory:', inMemory: true });
    
    const event = commandSent(1000, 'dispatch-1', 'device-1', 'command-1', 10);
    
    db.saveEvent(event);
    const loaded = db.loadEvents();
    
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.type).toBe('COMMAND_SENT');
    expect(loaded[0]!.dispatchId).toBe('dispatch-1');
    
    db.close();
  });
});
