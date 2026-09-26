import type { Device } from './types.js';
import { type ErcotZone } from './ercot.js';
export interface ZoneAllocation {
    zone: ErcotZone;
    devices: Device[];
    totalCapacityKw: number;
    availableCapacityKw: number;
    onlineCount: number;
    offlineCount: number;
}
/**
 * Groups devices by their zone and calculates zone-level capacity
 */
export declare function getZoneAllocations(devices: Device[]): ZoneAllocation[];
export interface ZonePreference {
    zoneId: string;
    weight: number;
}
/**
 * Sort devices by zone preference for dispatch allocation
 * Higher weighted zones are allocated from first
 */
export declare function sortDevicesByZonePreference(devices: Device[], preferences: ZonePreference[]): Device[];
/**
 * Creates default zone preferences based on net load
 * Zones with higher net load get higher priority (more need for DR)
 */
export declare function createLoadBasedPreferences(): ZonePreference[];
//# sourceMappingURL=zone-allocator.d.ts.map