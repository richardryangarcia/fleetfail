/**
 * Seeded pseudo-random number generator (Mulberry32)
 * Provides deterministic randomness for reproducible simulations
 */
export class SeededRandom {
    state;
    constructor(seed) {
        this.state = seed;
    }
    /** Returns float in [0, 1) */
    next() {
        let t = (this.state += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** Returns integer in [min, max] inclusive */
    int(min, max) {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }
    /** Returns float in [min, max) */
    float(min, max) {
        return this.next() * (max - min) + min;
    }
    /** Returns true with given probability */
    chance(probability) {
        return this.next() < probability;
    }
    /** Picks random element from array */
    pick(array) {
        if (array.length === 0)
            return undefined;
        return array[this.int(0, array.length - 1)];
    }
    /** Shuffles array in place (Fisher-Yates) */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.int(0, i);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}
//# sourceMappingURL=random.js.map