export function isNumeric(value: unknown): boolean {
    if (typeof value === 'number') {
        return true;
    }
    if (typeof value === 'string') {
        return /^-?\d+(\.\d+)?$/.test(value);
    }
    return false;
}