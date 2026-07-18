// eslint-disable-next-line typescript/no-explicit-any, jsdoc/require-jsdoc
export type Newable<T> = new (...args: any[]) => T;

/**
 * Checks whether or not the given value is a newable.
 * @param value - The value to check.
 * @returns True if the value is of type 'function' and has the class keyword, false otherwise.
 */
export function isNewable<T>(value: unknown): value is Newable<T> {
    return typeof value === 'function' && /^class[\s{]/.test(value.toString());
}