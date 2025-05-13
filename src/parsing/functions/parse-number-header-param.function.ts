import { isNumeric } from '../../encapsulation';

export function parseNumberHeaderParam(rawValue: string | undefined): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}