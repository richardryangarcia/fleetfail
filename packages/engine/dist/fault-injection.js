import { SeededRandom } from './random.js';
export class FaultInjector {
    activeFaults = new Map();
    rng;
    constructor(seed) {
        this.rng = new SeededRandom(seed);
    }
    injectFault(fault, now) {
        const active = {
            deviceId: fault.deviceId,
            faultType: fault.faultType,
            startTime: now,
            endTime: fault.durationMs ? now + fault.durationMs : null,
            triggeredCount: 0,
        };
        const deviceFaults = this.activeFaults.get(fault.deviceId) ?? [];
        deviceFaults.push(active);
        this.activeFaults.set(fault.deviceId, deviceFaults);
        return active;
    }
    clearFault(deviceId, faultType) {
        const faults = this.activeFaults.get(deviceId);
        if (faults) {
            const updated = faults.filter(f => f.faultType !== faultType);
            if (updated.length > 0) {
                this.activeFaults.set(deviceId, updated);
            }
            else {
                this.activeFaults.delete(deviceId);
            }
        }
    }
    clearAllFaults(deviceId) {
        this.activeFaults.delete(deviceId);
    }
    clearAllDeviceFaults() {
        this.activeFaults.clear();
    }
    getActiveFaults(deviceId, now) {
        const faults = this.activeFaults.get(deviceId) ?? [];
        const active = faults.filter(f => f.endTime === null || f.endTime > now);
        this.activeFaults.set(deviceId, active);
        return active;
    }
    hasFault(deviceId, faultType, now) {
        const faults = this.getActiveFaults(deviceId, now);
        return faults.some(f => f.faultType === faultType);
    }
    isDeviceOffline(deviceId, now) {
        return this.hasFault(deviceId, 'offline', now);
    }
    shouldLoseAck(deviceId, now) {
        return this.hasFault(deviceId, 'lost_ack', now);
    }
    shouldDelayAck(deviceId, now) {
        return this.hasFault(deviceId, 'delayed_ack', now);
    }
    shouldDuplicateDelivery(deviceId, now) {
        if (!this.hasFault(deviceId, 'duplicate_delivery', now)) {
            return false;
        }
        const faults = this.getActiveFaults(deviceId, now);
        const dupFault = faults.find(f => f.faultType === 'duplicate_delivery');
        if (dupFault) {
            dupFault.triggeredCount++;
        }
        return true;
    }
    hasStaleTelemetry(deviceId, now) {
        return this.hasFault(deviceId, 'stale_telemetry', now);
    }
    getAllActiveFaults(now) {
        const result = new Map();
        for (const [deviceId, faults] of this.activeFaults) {
            const active = this.getActiveFaults(deviceId, now);
            if (active.length > 0) {
                result.set(deviceId, active);
            }
        }
        return result;
    }
    injectRandomOutage(devices, count, now, durationMs) {
        const online = devices.filter(d => d.status === 'online');
        const shuffled = [...online];
        this.rng.shuffle(shuffled);
        const selected = shuffled.slice(0, count);
        for (const device of selected) {
            this.injectFault({ deviceId: device.id, faultType: 'offline', durationMs }, now);
        }
        return selected.map(d => d.id);
    }
}
//# sourceMappingURL=fault-injection.js.map