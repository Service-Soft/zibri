// eslint-disable-next-line jsdoc/require-jsdoc
type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
    ? Acc[number]
    : Enumerate<N, [...Acc, Acc['length']]>;

// eslint-disable-next-line jsdoc/require-jsdoc
export type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>;

/**
 * A number from 0 to 100.
 */
export type Percentage = IntRange<0, 101>;