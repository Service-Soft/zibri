import { isDate } from '../../utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
export function parseDate(rawValue: unknown): unknown {
    if (isDate(rawValue)) {
        return new Date(rawValue);
    }
    return rawValue;
}