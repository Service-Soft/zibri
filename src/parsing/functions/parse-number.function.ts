import { isNumeric } from '../../utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export function parseNumber(rawValue: unknown): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}