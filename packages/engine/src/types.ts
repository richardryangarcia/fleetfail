/**
 * FleetFail Domain Types
 * 
 * Key concepts:
 * - kW: Power (rate of energy delivery), used for dispatch targets
 * - kWh: Energy (capacity), used for battery storage
 * - SOC: State of Charge (0-100%), current battery level
 * - Reserve: Minimum SOC to maintain (e.g., 20% for grid stability)
 * - Freshness: Maximum age of telemetry before considered stale
 */

export type DeviceStatus = 'online' | 'offline' | 'reconnecting';

export interface Device {
  id: string;
  name: string;
  /** Maximum power output in kW */
  maxPowerKw: number;
  /** Total energy capacity in kWh */
  capacityKwh: number;
  /** Current state of charge (0-100) */
  socPercent: number;
  /** Minimum SOC to maintain (0-100) */
  reservePercent: number;
  /** Current connection status */
  status: DeviceStatus;
  /** Last telemetry timestamp (ms since epoch) */
  lastTelemetryAt: number;
  /** Current epoch for command sequencing */
  epoch: number;
  /** Last processed sequence number within epoch */
  lastSequence: number;
  /** Set of processed idempotency keys (for duplicate detection) */
  processedKeys: Set<string>;
  /** Zone identifier for geographic allocation */
  zone: string;
}

export interface Command {
  id: string;
  /** Unique key for idempotent delivery */
  idempotencyKey: string;
  /** Target device ID */
  deviceId: string;
  /** Parent dispatch ID */
  dispatchId: string;
  /** Absolute power setpoint in kW (positive = discharge) */
  setpointKw: number;
  /** Epoch for ordering (incremented on reconnect) */
  epoch: number;
  /** Sequence within epoch */
  sequence: number;
  /** Command expiration timestamp (ms) */
  expiresAt: number;
  /** When command was created (ms) */
  createdAt: number;
  /** Current delivery status */
  status: CommandStatus;
  /** Number of delivery attempts */
  attemptCount: number;
  /** Last attempt timestamp */
  lastAttemptAt: number | null;
  /** Acknowledged timestamp (if acked) */
  ackedAt: number | null;
}

export type CommandStatus = 
  | 'pending'
  | 'sent'
  | 'acked'
  | 'timeout'
  | 'stale_rejected'
  | 'duplicate_ignored'
  | 'device_offline'
  | 'expired';

export interface Dispatch {
  id: string;
  /** Target aggregate power in kW */
  targetKw: number;
  /** Currently allocated power in kW */
  allocatedKw: number;
  /** Actually delivered (acked) power in kW */
  deliveredKw: number;
  /** When dispatch was initiated (ms) */
  createdAt: number;
  /** When dispatch was completed or failed */
  completedAt: number | null;
  /** Overall status */
  status: DispatchStatus;
  /** Commands issued for this dispatch */
  commandIds: string[];
}

export type DispatchStatus = 
  | 'allocating'
  | 'executing'
  | 'converged'
  | 'partial'
  | 'insufficient_capacity'
  | 'failed';

export type EventType =
  | 'COMMAND_SENT'
  | 'ACK_TIMEOUT'
  | 'RETRY_SAME_ID'
  | 'DUPLICATE_IGNORED'
  | 'DEVICE_EXCLUDED'
  | 'REALLOCATED'
  | 'STALE_REJECTED'
  | 'DEVICE_OFFLINE'
  | 'DEVICE_ONLINE'
  | 'DEVICE_RECONNECTED'
  | 'DISPATCH_STARTED'
  | 'DISPATCH_CONVERGED'
  | 'DISPATCH_PARTIAL'
  | 'DISPATCH_INSUFFICIENT'
  | 'COMMAND_ACKED'
  | 'COMMAND_EXPIRED';

export interface FleetEvent {
  id: string;
  type: EventType;
  timestamp: number;
  dispatchId: string | null;
  deviceId: string | null;
  commandId: string | null;
  details: Record<string, unknown>;
}

export interface FleetMetrics {
  /** Total fleet capacity in kW */
  totalCapacityKw: number;
  /** Currently available capacity in kW */
  availableCapacityKw: number;
  /** Power that would violate reserves */
  reserveBlockedKw: number;
  /** Number of online devices */
  devicesOnline: number;
  /** Number of offline devices */
  devicesOffline: number;
  /** Total devices in fleet */
  totalDevices: number;
  /** Current dispatch target */
  dispatchTargetKw: number;
  /** Actually delivered (acked) power */
  deliveredKw: number;
  /** Commands pending ACK */
  pendingCommands: number;
  /** Commands timed out */
  timedOutCommands: number;
  /** Duplicate deliveries ignored */
  duplicatesIgnored: number;
  /** Stale commands rejected */
  staleRejected: number;
  /** Reallocations performed */
  reallocations: number;
}

export interface OrchestratorConfig {
  /** Timeout for command ACK in ms */
  ackTimeoutMs: number;
  /** Maximum retry attempts per command */
  maxRetries: number;
  /** Telemetry freshness threshold in ms */
  freshnessThresholdMs: number;
  /** Command expiration time in ms */
  commandExpiryMs: number;
  /** Tick interval for simulation in ms */
  tickIntervalMs: number;
  /** Random seed for deterministic simulation */
  seed: number;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  ackTimeoutMs: 5000,
  maxRetries: 3,
  freshnessThresholdMs: 30000,
  commandExpiryMs: 60000,
  tickIntervalMs: 1000,
  seed: 42,
};
