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
export const DEFAULT_CONFIG = {
    ackTimeoutMs: 5000,
    maxRetries: 3,
    freshnessThresholdMs: 30000,
    commandExpiryMs: 60000,
    tickIntervalMs: 1000,
    seed: 42,
};
//# sourceMappingURL=types.js.map