/**
 * ERCOT Weather Zone fixtures (synthetic data)
 *
 * This is SYNTHETIC data for demonstration purposes only.
 * Not actual ERCOT operational data.
 */
export interface ErcotZone {
    id: string;
    name: string;
    /** Synthetic net load in MW */
    netLoadMw: number;
    /** Synthetic temperature in °F */
    temperatureF: number;
    /** Synthetic wind generation in MW */
    windMw: number;
    /** Synthetic solar generation in MW */
    solarMw: number;
    /** Zone centroid for map display (lat, lng) */
    centroid: [number, number];
}
export declare const ERCOT_ZONES: ErcotZone[];
export declare function getZoneById(zoneId: string): ErcotZone | undefined;
export declare function getTotalGridLoad(): number;
export declare function getTotalRenewableGeneration(): number;
export interface GridStatus {
    totalLoadMw: number;
    renewablesMw: number;
    renewablePercent: number;
    avgTemperatureF: number;
    timestamp: number;
}
export declare function getGridStatus(): GridStatus;
//# sourceMappingURL=ercot.d.ts.map