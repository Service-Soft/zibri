// the construct signature carries no members of its own, so `prototype` read off one of these is
// `any`. Declaring it here was tried and reverted: `Newable` is taken apart with `Omit` in the
// open api service, and a declared `prototype` becomes one more key those omissions have to know
// about - so the narrowing belongs at the one place that reads it.
// eslint-disable-next-line typescript/no-explicit-any, jsdoc-js/require-jsdoc
export type Newable<T> = new (...args: any[]) => T;

/**
 * Checks whether or not the given value is a newable.
 * @param value - The value to check.
 * @returns True if the value is of type 'function' and has the class keyword, false otherwise.
 */
export function isNewable<T>(value: unknown): value is Newable<T> {
    return typeof value === 'function' && /^class[\s{]/.test(value.toString());
}