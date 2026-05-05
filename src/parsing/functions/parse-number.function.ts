import { isNumeric } from '../../utilities/is-numeric.function';

/**
 * Regex that matches integers.
 */
export const INTEGER_REGEX: RegExp = /^-?(0|[1-9]\d*)$/;

// eslint-disable-next-line jsdoc/require-jsdoc
export function parseNumber(rawValue: unknown): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }

    if (typeof rawValue !== 'string') {
        return rawValue;
    }

    if (!INTEGER_REGEX.test(rawValue)) {
        const asNumber: number = Number(rawValue);
        return Number.isFinite(asNumber) ? asNumber : rawValue;
    }

    const asBigInt: bigint = BigInt(rawValue);
    if (
        asBigInt > BigInt(Number.MAX_SAFE_INTEGER)
        || asBigInt < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
        return asBigInt;
    }

    return Number(rawValue);
}