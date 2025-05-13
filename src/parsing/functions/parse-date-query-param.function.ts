import { isDate } from '../../encapsulation';

export function parseDateQueryParam(rawValue: unknown): unknown {
    if (isDate(rawValue)) {
        return new Date(rawValue);
    }
    return rawValue;
}