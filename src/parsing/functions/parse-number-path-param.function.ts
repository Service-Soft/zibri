import { isNumeric } from '../../utilities';

export function parseNumberPathParam(rawValue: string | undefined): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}