import { isDate } from '../../utilities/is-date.function';

// eslint-disable-next-line jsdoc/require-jsdoc
export function parseDate(rawValue: unknown): unknown {
    return isDate(rawValue) ? new Date(rawValue) : rawValue;
}