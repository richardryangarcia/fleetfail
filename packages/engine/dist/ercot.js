/**
 * ERCOT Weather Zone fixtures (synthetic data)
 *
 * This is SYNTHETIC data for demonstration purposes only.
 * Not actual ERCOT operational data.
 */
export const ERCOT_ZONES = [
    {
        id: 'COAST',
        name: 'Coast',
        netLoadMw: 8500,
        temperatureF: 82,
        windMw: 1200,
        solarMw: 450,
        centroid: [29.0, -95.5],
    },
    {
        id: 'EAST',
        name: 'East',
        netLoadMw: 6200,
        temperatureF: 78,
        windMw: 800,
        solarMw: 380,
        centroid: [32.0, -95.0],
    },
    {
        id: 'FAR_WEST',
        name: 'Far West',
        netLoadMw: 2100,
        temperatureF: 95,
        windMw: 4500,
        solarMw: 1200,
        centroid: [31.5, -103.0],
    },
    {
        id: 'NORTH',
        name: 'North',
        netLoadMw: 5800,
        temperatureF: 76,
        windMw: 2200,
        solarMw: 320,
        centroid: [33.5, -97.0],
    },
    {
        id: 'NORTH_C',
        name: 'North Central',
        netLoadMw: 12500,
        temperatureF: 79,
        windMw: 1800,
        solarMw: 560,
        centroid: [32.8, -96.8],
    },
    {
        id: 'SOUTH_C',
        name: 'South Central',
        netLoadMw: 9200,
        temperatureF: 84,
        windMw: 1500,
        solarMw: 680,
        centroid: [29.8, -98.5],
    },
    {
        id: 'SOUTHERN',
        name: 'Southern',
        netLoadMw: 4800,
        temperatureF: 86,
        windMw: 900,
        solarMw: 520,
        centroid: [27.5, -97.5],
    },
    {
        id: 'WEST',
        name: 'West',
        netLoadMw: 3200,
        temperatureF: 91,
        windMw: 3800,
        solarMw: 950,
        centroid: [31.0, -100.0],
    },
];
export function getZoneById(zoneId) {
    return ERCOT_ZONES.find(z => z.id === zoneId);
}
export function getTotalGridLoad() {
    return ERCOT_ZONES.reduce((sum, z) => sum + z.netLoadMw, 0);
}
export function getTotalRenewableGeneration() {
    return ERCOT_ZONES.reduce((sum, z) => sum + z.windMw + z.solarMw, 0);
}
export function getGridStatus() {
    const totalLoad = getTotalGridLoad();
    const renewables = getTotalRenewableGeneration();
    const avgTemp = ERCOT_ZONES.reduce((sum, z) => sum + z.temperatureF, 0) / ERCOT_ZONES.length;
    return {
        totalLoadMw: totalLoad,
        renewablesMw: renewables,
        renewablePercent: (renewables / totalLoad) * 100,
        avgTemperatureF: avgTemp,
        timestamp: Date.now(),
    };
}
//# sourceMappingURL=ercot.js.map