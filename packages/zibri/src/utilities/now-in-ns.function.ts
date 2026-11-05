import { NumberUtilities } from './number.utilities';

const startHr: bigint = process.hrtime.bigint();
// its okay that we loose precision here, that's what the calculation below is for
const startInNs: bigint = BigInt(NumberUtilities.multiply(Date.now(), 1_000_000).toString());

/**
 * Gets the current timestamp with nanosecond precision.
 * @returns The nanoseconds as a bigint.
 */
export function nowInNs(): bigint {
    return startInNs + (process.hrtime.bigint() - startHr);
}