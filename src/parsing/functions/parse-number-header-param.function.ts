import { isNumeric } from '../../utilities';

export function parseNumberHeaderParam(rawValue: string | undefined): unknown {
    if (!isNumeric(rawValue)) {
        return rawValue;
    }
    return Number(rawValue);
}