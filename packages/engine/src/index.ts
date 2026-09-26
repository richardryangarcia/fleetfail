// Types
export type {
  Device,
  DeviceStatus,
  Command,
  CommandStatus,
  Dispatch,
  DispatchStatus,
  EventType,
  FleetEvent,
  FleetMetrics,
  OrchestratorConfig,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';

// Device operations
export {
  createDevice,
  seedFleet,
  getAvailablePowerKw,
  setDeviceStatus,
  updateDeviceTelemetry,
  isTelemetryFresh,
  applyCommandEffect,
  type DeviceSpec,
} from './device.js';

// Command operations
export {
  createCommand,
  markSent,
  markAcked,
  markTimeout,
  markStaleRejected,
  markDuplicateIgnored,
  markDeviceOffline,
  markExpired,
  isCommandExpired,
  shouldRetry,
  validateCommand,
  applyCommandToDevice,
  type CreateCommandParams,
  type CommandValidation,
} from './command.js';

// Dispatch operations
export {
  createDispatch,
  updateDispatchAllocation,
  addDeliveredPower,
  removeDeliveredPower,
  setDispatchStatus,
  checkDispatchConvergence,
} from './dispatch.js';

// Event creators
export * as events from './event.js';

// Fault injection
export {
  FaultInjector,
  type FaultType,
  type FaultConfig,
  type ActiveFault,
} from './fault-injection.js';

// Random number generator
export { SeededRandom } from './random.js';

// Main orchestrator
export { Orchestrator, type OrchestratorState, type DeliveryResult } from './orchestrator.js';

// Database persistence
export { FleetDb, type DbConfig } from './db.js';

// ERCOT zone fixtures (synthetic)
export {
  ERCOT_ZONES,
  getZoneById,
  getTotalGridLoad,
  getTotalRenewableGeneration,
  getGridStatus,
  type ErcotZone,
  type GridStatus,
} from './ercot.js';

// ERCOT cached real data
export {
  generateErcotCacheSnapshot,
  getZoneStressRanking,
  createCachedLoadPreferences,
  getErcotCache,
  resetErcotCache,
  type ErcotZoneLoad,
  type ErcotGridSummary,
  type ErcotCacheData,
} from './ercot-cache.js';

// Zone-preference allocator
export {
  getZoneAllocations,
  sortDevicesByZonePreference,
  createLoadBasedPreferences,
  type ZoneAllocation,
  type ZonePreference,
} from './zone-allocator.js';
