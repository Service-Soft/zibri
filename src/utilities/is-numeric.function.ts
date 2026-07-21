const NUMERIC_REGEX: RegExp = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * Checks whether or not the given value is numeric.
 * @param value - The value to check.
 * @returns True if the value is numeric, false otherwise.
 */
export function isNumeric(value: unknown): value is number | string {
    if (typeof value === 'number') {
        return !Number.isNaN(value);
    }
    if (typeof value === 'string') {
        return NUMERIC_REGEX.test(value);
    }
    return false;
}