import { isNumeric } from '../../utilities';

export function parseNumberQueryParam(rawValue: unknown): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}