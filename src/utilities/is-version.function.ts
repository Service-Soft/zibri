import { Version } from '../types';
import { isNumeric } from './is-numeric.function';

export function isVersion(value: string): value is Version {
    const parts: string[] = value.split('.');
    if (parts.length !== 3) {
        return false;
    }
    const [one, two, three] = parts;
    return isNumeric(one) && isNumeric(two) && isNumeric(three);
}