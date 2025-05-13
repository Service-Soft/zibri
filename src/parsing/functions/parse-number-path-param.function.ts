import { isNumeric } from '../../encapsulation';

export function parseNumberPathParam(rawValue: string | undefined): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}