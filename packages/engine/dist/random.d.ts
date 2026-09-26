/**
 * Seeded pseudo-random number generator (Mulberry32)
 * Provides deterministic randomness for reproducible simulations
 */
export declare class SeededRandom {
    private state;
    constructor(seed: number);
    /** Returns float in [0, 1) */
    next(): number;
    /** Returns integer in [min, max] inclusive */
    int(min: number, max: number): number;
    /** Returns float in [min, max) */
    float(min: number, max: number): number;
    /** Returns true with given probability */
    chance(probability: number): boolean;
    /** Picks random element from array */
    pick<T>(array: T[]): T | undefined;
    /** Shuffles array in place (Fisher-Yates) */
    shuffle<T>(array: T[]): T[];
}
//# sourceMappingURL=random.d.ts.map