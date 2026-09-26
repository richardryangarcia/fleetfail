export { DEFAULT_CONFIG } from './types.js';
// Device operations
export { createDevice, seedFleet, getAvailablePowerKw, setDeviceStatus, updateDeviceTelemetry, isTelemetryFresh, applyCommandEffect, } from './device.js';
// Command operations
export { createCommand, markSent, markAcked, markTimeout, markStaleRejected, markDuplicateIgnored, markDeviceOffline, markExpired, isCommandExpired, shouldRetry, validateCommand, applyCommandToDevice, } from './command.js';
// Dispatch operations
export { createDispatch, updateDispatchAllocation, addDeliveredPower, removeDeliveredPower, setDispatchStatus, checkDispatchConvergence, } from './dispatch.js';
// Event creators
export * as events from './event.js';
// Fault injection
export { FaultInjector, } from './fault-injection.js';
// Random number generator
export { SeededRandom } from './random.js';
// Main orchestrator
export { Orchestrator } from './orchestrator.js';
// Database persistence
export { FleetDb } from './db.js';
// ERCOT zone fixtures (synthetic)
export { ERCOT_ZONES, getZoneById, getTotalGridLoad, getTotalRenewableGeneration, getGridStatus, } from './ercot.js';
// Zone-preference allocator
export { getZoneAllocations, sortDevicesByZonePreference, createLoadBasedPreferences, } from './zone-allocator.js';
//# sourceMappingURL=index.js.map