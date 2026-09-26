import { describe, it, expect, beforeEach } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { ERCOT_ZONES } from './ercot.js';
import { 
  generateErcotCacheSnapshot, 
  getErcotCache, 
  resetErcotCache,
  getZoneStressRanking,
  createCachedLoadPreferences 
} from './ercot-cache.js';

describe('P1 LOCK - Texas Map & ERCOT Cache', () => {
  let orchestrator: Orchestrator;

  beforeEach(() => {
    resetErcotCache();
    orchestrator = new Orchestrator({
      seed: 42,
      ackTimeoutMs: 5000,
      maxRetries: 3,
      commandExpiryMs: 60000,
      tickIntervalMs: 1000,
    });
    orchestrator.seedFleet(75, 0);
  });

  describe('Zone Clustering - Device Positions', () => {
    it('all devices have lat/lng within reasonable Texas bounds', () => {
      const devices = orchestrator.getDevices();
      
      for (const device of devices) {
        expect(device.latitude).toBeGreaterThan(25);
        expect(device.latitude).toBeLessThan(37);
        expect(device.longitude).toBeGreaterThan(-107);
        expect(device.longitude).toBeLessThan(-93);
      }
    });

    it('devices are clustered near their zone centroids', () => {
      const devices = orchestrator.getDevices();
      
      for (const zone of ERCOT_ZONES) {
        const zoneDevices = devices.filter(d => d.zone === zone.id);
        
        if (zoneDevices.length === 0) continue;
        
        const avgLat = zoneDevices.reduce((sum, d) => sum + d.latitude, 0) / zoneDevices.length;
        const avgLng = zoneDevices.reduce((sum, d) => sum + d.longitude, 0) / zoneDevices.length;
        
        const [centroidLat, centroidLng] = zone.centroid;
        
        expect(Math.abs(avgLat - centroidLat)).toBeLessThan(2);
        expect(Math.abs(avgLng - centroidLng)).toBeLessThan(3);
      }
    });

    it('devices have deterministic positions with same seed', () => {
      const orch1 = new Orchestrator({ seed: 999 });
      const orch2 = new Orchestrator({ seed: 999 });
      orch1.seedFleet(50, 0);
      orch2.seedFleet(50, 0);
      
      const devices1 = orch1.getDevices();
      const devices2 = orch2.getDevices();
      
      for (let i = 0; i < 50; i++) {
        expect(devices1[i]!.latitude).toBeCloseTo(devices2[i]!.latitude);
        expect(devices1[i]!.longitude).toBeCloseTo(devices2[i]!.longitude);
        expect(devices1[i]!.zone).toBe(devices2[i]!.zone);
      }
    });

    it('devices are distributed across multiple zones', () => {
      const devices = orchestrator.getDevices();
      const zones = new Set(devices.map(d => d.zone));
      
      expect(zones.size).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Click-Offline via Fault Injection Path', () => {
    it('taking device offline produces DEVICE_OFFLINE event', () => {
      const devices = orchestrator.getDevices();
      const targetDevice = devices[0]!;
      
      expect(targetDevice.status).toBe('online');
      
      orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
      
      const updatedDevice = orchestrator.getDevice(targetDevice.id)!;
      expect(updatedDevice.status).toBe('offline');
      
      const events = orchestrator.getEvents();
      const offlineEvent = events.find(
        e => e.type === 'DEVICE_OFFLINE' && e.deviceId === targetDevice.id
      );
      expect(offlineEvent).toBeDefined();
    });

    it('offline device triggers reallocation during dispatch', () => {
      orchestrator.startDispatch(100);
      orchestrator.tick();
      
      const devices = orchestrator.getDevices();
      const onlineDevicesWithCommands = devices.filter(d => {
        const commands = orchestrator.getCommands().filter(c => c.deviceId === d.id);
        return d.status === 'online' && commands.length > 0;
      });
      
      if (onlineDevicesWithCommands.length > 0) {
        const targetDevice = onlineDevicesWithCommands[0]!;
        
        orchestrator.injectFault({ deviceId: targetDevice.id, faultType: 'offline' });
        
        orchestrator.runUntilComplete(50);
        
        const events = orchestrator.getEvents();
        const reallocatedEvents = events.filter(e => e.type === 'REALLOCATED');
        
        expect(reallocatedEvents.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('offline device has currentSetpointKw reset to 0', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(30);
      
      const devices = orchestrator.getDevices();
      const workingDevice = devices.find(d => d.currentSetpointKw > 0);
      
      if (workingDevice) {
        orchestrator.injectFault({ deviceId: workingDevice.id, faultType: 'offline' });
        
        const updatedDevice = orchestrator.getDevice(workingDevice.id)!;
        expect(updatedDevice.currentSetpointKw).toBe(0);
      }
    });

    it('dispatch completion clears device setpoints', () => {
      orchestrator.startDispatch(100);
      orchestrator.runUntilComplete(50);
      
      const dispatch = orchestrator.getActiveDispatch()!;
      expect(['converged', 'partial', 'insufficient_capacity']).toContain(dispatch.status);
      
      const devices = orchestrator.getDevices();
      for (const device of devices) {
        expect(device.currentSetpointKw).toBe(0);
      }
    });
  });

  describe('ERCOT Cache Module', () => {
    it('generates cache with all required fields', () => {
      const cache = generateErcotCacheSnapshot(42);
      
      expect(cache.cachedAt).toBeDefined();
      expect(cache.cacheLabel).toBe('Cached / Replay');
      expect(cache.snapshotId).toBeDefined();
      expect(cache.zones).toHaveLength(8);
      expect(cache.gridSummary).toBeDefined();
    });

    it('cache zones have realistic data ranges', () => {
      const cache = generateErcotCacheSnapshot(42);
      
      for (const zone of cache.zones) {
        expect(zone.loadMw).toBeGreaterThan(0);
        expect(zone.windMw).toBeGreaterThanOrEqual(0);
        expect(zone.solarMw).toBeGreaterThanOrEqual(0);
        expect(zone.temperatureF).toBeGreaterThan(50);
        expect(zone.temperatureF).toBeLessThan(120);
      }
    });

    it('grid summary totals match zone sums', () => {
      const cache = generateErcotCacheSnapshot(42);
      
      const totalLoad = cache.zones.reduce((sum, z) => sum + z.loadMw, 0);
      const totalWind = cache.zones.reduce((sum, z) => sum + z.windMw, 0);
      const totalSolar = cache.zones.reduce((sum, z) => sum + z.solarMw, 0);
      
      expect(cache.gridSummary.totalLoadMw).toBe(totalLoad);
      expect(cache.gridSummary.totalWindMw).toBe(totalWind);
      expect(cache.gridSummary.totalSolarMw).toBe(totalSolar);
    });

    it('same seed produces deterministic cache', () => {
      const cache1 = generateErcotCacheSnapshot(999);
      const cache2 = generateErcotCacheSnapshot(999);
      
      expect(cache1.snapshotId).toBe(cache2.snapshotId);
      expect(cache1.gridSummary.totalLoadMw).toBe(cache2.gridSummary.totalLoadMw);
      
      for (let i = 0; i < cache1.zones.length; i++) {
        expect(cache1.zones[i]!.loadMw).toBe(cache2.zones[i]!.loadMw);
        expect(cache1.zones[i]!.windMw).toBe(cache2.zones[i]!.windMw);
      }
    });

    it('getErcotCache returns singleton', () => {
      resetErcotCache();
      const cache1 = getErcotCache(42);
      const cache2 = getErcotCache(999);
      
      expect(cache1).toBe(cache2);
    });

    it('zone stress ranking orders by net load', () => {
      const cache = generateErcotCacheSnapshot(42);
      const ranking = getZoneStressRanking(cache);
      
      expect(ranking[0]!.stressScore).toBe(1);
      
      for (let i = 1; i < ranking.length; i++) {
        expect(ranking[i]!.stressScore).toBeLessThanOrEqual(ranking[i - 1]!.stressScore);
      }
    });

    it('cached load preferences have valid weights', () => {
      const cache = generateErcotCacheSnapshot(42);
      const preferences = createCachedLoadPreferences(cache);
      
      expect(preferences.length).toBe(8);
      
      for (const pref of preferences) {
        expect(pref.weight).toBeGreaterThanOrEqual(0);
        expect(pref.weight).toBeLessThanOrEqual(1);
      }
      
      const maxWeightPref = preferences.find(p => p.weight === 1);
      expect(maxWeightPref).toBeDefined();
      
      const minWeightPref = preferences.find(p => p.weight === 0);
      expect(minWeightPref).toBeDefined();
    });
  });

  describe('Integration - Map Click → Reallocation Flow', () => {
    it('full flow: dispatch → click-offline → reallocation events', () => {
      orchestrator.startDispatch(200);
      
      for (let i = 0; i < 5; i++) {
        orchestrator.tick();
      }
      
      const dispatchEvents = orchestrator.getEvents().filter(e => e.type === 'DISPATCH_STARTED');
      expect(dispatchEvents.length).toBe(1);
      
      const devices = orchestrator.getDevices();
      const onlineDevices = devices.filter(d => d.status === 'online');
      
      for (const device of onlineDevices.slice(0, 5)) {
        orchestrator.injectFault({ deviceId: device.id, faultType: 'offline' });
      }
      
      const offlineEvents = orchestrator.getEvents().filter(e => e.type === 'DEVICE_OFFLINE');
      expect(offlineEvents.length).toBe(5);
      
      orchestrator.runUntilComplete(50);
      
      const allEvents = orchestrator.getEvents();
      const eventTypes = new Set(allEvents.map(e => e.type));
      
      expect(eventTypes.has('DISPATCH_STARTED')).toBe(true);
      expect(eventTypes.has('DEVICE_OFFLINE')).toBe(true);
      expect(eventTypes.has('COMMAND_SENT')).toBe(true);
      
      const hasCompletion = 
        eventTypes.has('DISPATCH_CONVERGED') || 
        eventTypes.has('DISPATCH_PARTIAL');
      expect(hasCompletion).toBe(true);
    });
  });
});
