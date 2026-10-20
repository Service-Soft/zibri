import { BigNumber } from '../../utilities/number.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';

/**
 * Converts a value into one json can carry, leaving what reads it back to the metadata.
 *
 * Json holds strings, numbers, booleans, arrays and objects. A date, a bigint past
 * `Number.MAX_SAFE_INTEGER` and an exact decimal are none of those, so each becomes the text it
 * reads as - the same text the column of its own would have held. What turns that text back into
 * the value is the property declaring what it is, which is why this direction needs no metadata and
 * the other one does.
 *
 * Applied all the way down, because a json column holds whole objects: the value that needs
 * converting is as often several levels inside one as it is the column itself.
 *
 * The three kinds it converts are the three a property can name, so each of them has a way back.
 * Anything else stays whatever json makes of it, which keeps a property that describes nothing
 * holding what it always held.
 * @param value - The value to convert.
 * @returns The same value, with everything json cannot carry written as a string.
 */
export function toJsonValue(value: unknown): unknown {
    if (typeof value === 'bigint') {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    // toFixed rather than toString, so that a value past bignumber.js's exponent threshold is
    // written out in full instead of as "1e+25"
    if (value instanceof BigNumber) {
        return value.toFixed();
    }
    if (Array.isArray(value)) {
        return value.map(item => toJsonValue(item));
    }
    if (typeof value !== 'object' || value === null) {
        return value;
    }

    const res: Record<string, unknown> = {};
    for (const [key, property] of ObjectUtilities.entries(value)) {
        res[key] = toJsonValue(property);
    }
    return res;
}