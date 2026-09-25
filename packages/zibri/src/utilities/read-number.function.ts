import { BigNumber } from './number.utilities';
import { AnyNumber } from '../data-source/models/where/number-where-filter.model';
import { NumberFormat } from '../entity/models/number-property-metadata.model';

/**
 * Reads a stored or transported number back into the type its format declares.
 *
 * Numbers travel as text between the process and everything outside it, because two of the four
 * formats have no other way through: a whole number past `Number.MAX_SAFE_INTEGER` and an exact
 * decimal both lose digits the moment they are a javascript number. The format says which type the
 * text is meant to become, and every format is stored as something that type holds exactly - so
 * this is a change of representation rather than a conversion that can lose anything.
 * @param value - The value as it was stored or received.
 * @param format - What kind of number the property holds.
 * @returns The value as the type the format declares.
 */
export function readNumber(value: string | number | bigint, format: NumberFormat): AnyNumber {
    switch (format) {
        case 'bigint': {
            return BigInt(value);
        }
        case 'bignumber': {
            return new BigNumber(String(value));
        }
        case 'integer':
        case 'number': {
            return Number(value);
        }
    }
}