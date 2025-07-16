import { Version } from '../types';
import { isNumeric } from './is-numeric.function';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks whether the given value is a valid SemVer Version.
 * @param value - The value to check.
 */
export function isVersion(value: string): value is Version {
    const parts: string[] = value.split('.');
    if (parts.length !== 3) {
        return false;
    }
    const [one, two, three] = parts;
    return isNumeric(one) && isNumeric(two) && isNumeric(three);
}