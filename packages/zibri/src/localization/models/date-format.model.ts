
// eslint-disable-next-line jsdoc/require-jsdoc
type AllLetters = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i' | 'j' | 'k' | 'l' | 'm'
    | 'n' | 'o' | 'p' | 'q' | 'r' | 's' | 't' | 'u' | 'v' | 'w' | 'x' | 'y' | 'z';

// order is relevant here
// eslint-disable-next-line typescript/typedef, jsdoc/require-jsdoc
export const dateFormatTokens = [
    'YYYY', // 2026 (4 digit year)
    'YY', // 26 (2 digit year)

    'MMMM', // January (full month name, depends on the provided labels)
    'MM', // 01 (2 digit month)
    'M', // 1 (1 digit month)

    'DD', // 09 (2 digit day of month)
    'D', // 9 (1 digit day of month)

    'dddd', // Friday (full weekday name, depends on the provided labels)

    'hh', // 05 (2 digit AM/PM hours)
    'h', // 5 (1 digit AM/PM hours)
    'HH', // 17 (2 digit hours)
    'H', // 17 (1 digit hours)

    'mm', // 05 (2 digit minute)
    'm', // 5 (1 digit minute)

    'ss', // 09 (2 digit seconds)
    's', // 9 (1 digit seconds)

    'A', // AM/PM
    'a' // am/pm
] as const;

/**
 * Type of all valid date format tokens, like eg. DD or YYYY.
 */
export type DateFormatToken = typeof dateFormatTokens[number];

/**
 * All English letters (used to detect invalid token starts).
 */
type Letter = AllLetters | Uppercase<AllLetters>;

/**
 * Recursively checks whether a string literal is a valid date format.
 * A valid format consists of tokens (DD, MM, YYYY, HH, …) and
 * any non‑letter separators (e.g. '.', '-', '/', ' ', …).
 */
type ValidateFormat<S extends string> = S extends '' ? true
    // order matters: longer tokens first
    : S extends `${DateFormatToken}${infer Rest}` ? ValidateFormat<Rest>
        : S extends `${infer First}${infer Rest}`
            ? (First extends Letter ? false : ValidateFormat<Rest>)
            : false;

/**
 * Helper: extracts the valid string literal type or returns `never`.
 */
export type DateFormatString<S extends string> = ValidateFormat<S> extends true ? S : never;

/**
 * Shortcut for the default date formats 'date', 'date-time' and 'time' .
 */
export type DateFormatShortcut = 'date' | 'date-time' | 'time';

/**
 * A validated date format string.
 */
export type DefinedDateFormatString = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    __brand: 'DateFormat'
};