import { isDate } from '../../utilities';

export function parseDateHeaderParam(rawValue: unknown): unknown {
    if (isDate(rawValue)) {
        return new Date(rawValue);
    }
    return rawValue;
}