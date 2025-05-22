import { isNumeric } from '../../utilities';

export function parseNumber(rawValue: unknown): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}