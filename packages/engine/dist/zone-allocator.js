import { getAvailablePowerKw } from './device.js';
import { ERCOT_ZONES } from './ercot.js';
/**
 * Groups devices by their zone and calculates zone-level capacity
 */
export function getZoneAllocations(devices) {
    const zoneMap = new Map();
    for (const device of devices) {
        const existing = zoneMap.get(device.zone) ?? [];
        existing.push(device);
        zoneMap.set(device.zone, existing);
    }
    return ERCOT_ZONES.map(zone => {
        const zoneDevices = zoneMap.get(zone.id) ?? [];
        const online = zoneDevices.filter(d => d.status === 'online');
        const offline = zoneDevices.filter(d => d.status !== 'online');
        return {
            zone,
            devices: zoneDevices,
            totalCapacityKw: zoneDevices.reduce((sum, d) => sum + d.maxPowerKw, 0),
            availableCapacityKw: online.reduce((sum, d) => sum + getAvailablePowerKw(d), 0),
            onlineCount: online.length,
            offlineCount: offline.length,
        };
    }).filter(za => za.devices.length > 0);
}
/**
 * Sort devices by zone preference for dispatch allocation
 * Higher weighted zones are allocated from first
 */
export function sortDevicesByZonePreference(devices, preferences) {
    const weightMap = new Map();
    for (const pref of preferences) {
        weightMap.set(pref.zoneId, pref.weight);
    }
    return [...devices].sort((a, b) => {
        const weightA = weightMap.get(a.zone) ?? 0;
        const weightB = weightMap.get(b.zone) ?? 0;
        if (weightB !== weightA) {
            return weightB - weightA;
        }
        return getAvailablePowerKw(b) - getAvailablePowerKw(a);
    });
}
/**
 * Creates default zone preferences based on net load
 * Zones with higher net load get higher priority (more need for DR)
 */
export function createLoadBasedPreferences() {
    const maxLoad = Math.max(...ERCOT_ZONES.map(z => z.netLoadMw));
    return ERCOT_ZONES.map(zone => ({
        zoneId: zone.id,
        weight: zone.netLoadMw / maxLoad,
    }));
}
//# sourceMappingURL=zone-allocator.js.map