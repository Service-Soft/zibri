import { NumberFormat } from '../../entity/models/number-property-metadata.model';
import { isNumeric } from '../../utilities/is-numeric.function';
import { readNumber } from '../../utilities/read-number.function';

/**
 * Regex that matches integers.
 */
export const INTEGER_REGEX: RegExp = /^-?(0|[1-9]\d*)$/;

// eslint-disable-next-line jsdoc/require-jsdoc
export function parseNumber(rawValue: unknown, format: NumberFormat = 'number'): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }

    try {
        // a `bigint` and an exact decimal both arrive as text, because neither survives json as a
        // number - so what a value already is says nothing about what the property holds, and the
        // format is what decides. A json number reaching one of those becomes one too, rather than
        // staying the double it was written as
        return readNumber(rawValue, format);
    }
    catch {
        // unreadable as the format the property declares - "1.5" for a whole number, say. Handed on
        // untouched so that validation answers with the key and the type it wanted, which is an
        // answer the caller can act on; a parser that throws is a 500 before anything is validated
        return rawValue;
    }
}