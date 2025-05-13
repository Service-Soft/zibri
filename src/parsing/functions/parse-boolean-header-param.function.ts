
export function parseBooleanHeaderParam(rawValue: unknown): unknown {
    if (typeof rawValue === 'boolean') {
        return rawValue;
    }
    if (typeof rawValue === 'string') {
        if (rawValue === 'true') {
            return true;
        }
        if (rawValue === 'false') {
            return false;
        }
    }
    return rawValue;
}