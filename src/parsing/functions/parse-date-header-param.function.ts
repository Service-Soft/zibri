import { isDate } from '../../encapsulation';

export function parseDateHeaderParam(rawValue: unknown): unknown {
    if (isDate(rawValue)) {
        return new Date(rawValue);
    }
    return rawValue;
}