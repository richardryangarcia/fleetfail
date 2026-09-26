// Types
export type {
  Device,
  DeviceStatus,
  DeviceGeneration,
  DeviceRegion,
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
  markReallocated,
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

// ERCOT zone fixtures (synthetic) + IL zones
export {
  ERCOT_ZONES,
  IL_ZONES,
  ALL_ZONES,
  getZoneById,
  getTotalGridLoad,
  getTotalRenewableGeneration,
  getGridStatus,
  type ErcotZone,
  type GridZone,
  type GridStatus,
  type ZoneBounds,
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
  type ErcotHourlySnapshot,
} from './ercot-cache.js';

// ERCOT real fixture data (documented source)
export {
  ERCOT_REAL_FIXTURE,
  IL_REAL_FIXTURE,
  COMBINED_REAL_FIXTURE,
  getErcotRealFixture,
  getCombinedRealFixture,
  generateHourlyFixtureData,
  getFixtureWithHourlyData,
  getCombinedFixtureWithHourlyData,
} from './ercot-fixture.js';

// Zone-preference allocator
export {
  getZoneAllocations,
  sortDevicesByZonePreference,
  createLoadBasedPreferences,
  type ZoneAllocation,
  type ZonePreference,
} from './zone-allocator.js';
