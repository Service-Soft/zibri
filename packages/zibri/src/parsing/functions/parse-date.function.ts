import { isDate } from '../../utilities/is-date.function.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
export function parseDate(rawValue: unknown): unknown {
    if (isDate(rawValue)) {
        return new Date(rawValue);
    }
    return rawValue;
}