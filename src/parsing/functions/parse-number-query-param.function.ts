import { isNumeric } from '../../encapsulation';

export function parseNumberQueryParam(rawValue: unknown): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}