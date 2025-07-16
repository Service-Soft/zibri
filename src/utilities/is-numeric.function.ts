/**
 * Checks whether or not the given value is numeric.
 * @param value - The value to check.
 * @returns True if the value is numeric, false otherwise.
 */
export function isNumeric(value: unknown): boolean {
    if (typeof value === 'number') {
        return true;
    }
    if (typeof value === 'string') {
        return /^-?\d+(\.\d+)?$/.test(value);
    }
    return false;
}