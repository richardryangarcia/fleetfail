import { v4 as uuid } from 'uuid';
import { SeededRandom } from './random.js';
const ZONES = ['COAST', 'EAST', 'FAR_WEST', 'NORTH', 'NORTH_C', 'SOUTH_C', 'SOUTHERN', 'WEST'];
const DEVICE_NAMES = [
    'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta',
    'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho',
    'Sigma', 'Tau', 'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega'
];
export function createDevice(spec = {}, rng, now, nameIndex) {
    const nameSuffix = Math.floor(nameIndex / DEVICE_NAMES.length) || '';
    const baseName = DEVICE_NAMES[nameIndex % DEVICE_NAMES.length];
    return {
        id: uuid(),
        name: `${baseName}${nameSuffix}-${rng.int(100, 999)}`,
        maxPowerKw: spec.maxPowerKw ?? rng.float(5, 15),
        capacityKwh: spec.capacityKwh ?? rng.float(10, 30),
        socPercent: spec.socPercent ?? rng.float(40, 95),
        reservePercent: spec.reservePercent ?? 20,
        status: 'online',
        lastTelemetryAt: now,
        epoch: 1,
        lastSequence: 0,
        processedKeys: new Set(),
        zone: spec.zone ?? rng.pick(ZONES),
    };
}
export function seedFleet(count, seed, now) {
    const rng = new SeededRandom(seed);
    const devices = [];
    for (let i = 0; i < count; i++) {
        devices.push(createDevice({}, rng, now, i));
    }
    return devices;
}
export function getAvailablePowerKw(device) {
    if (device.status !== 'online')
        return 0;
    const availableSoc = Math.max(0, device.socPercent - device.reservePercent);
    const availableEnergyKwh = (availableSoc / 100) * device.capacityKwh;
    return Math.min(device.maxPowerKw, availableEnergyKwh);
}
export function setDeviceStatus(device, status, now) {
    const updated = { ...device, status };
    if (status === 'online' && device.status !== 'online') {
        updated.epoch = device.epoch + 1;
        updated.lastSequence = 0;
        updated.lastTelemetryAt = now;
    }
    return updated;
}
export function updateDeviceTelemetry(device, now) {
    return { ...device, lastTelemetryAt: now };
}
export function isTelemetryFresh(device, now, thresholdMs) {
    return now - device.lastTelemetryAt < thresholdMs;
}
export function applyCommandEffect(device, setpointKw, durationHours) {
    const energyConsumedKwh = setpointKw * durationHours;
    const socDelta = (energyConsumedKwh / device.capacityKwh) * 100;
    const newSoc = Math.max(device.reservePercent, device.socPercent - socDelta);
    return { ...device, socPercent: newSoc };
}
//# sourceMappingURL=device.js.map