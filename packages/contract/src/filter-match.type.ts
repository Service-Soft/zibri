/**
 * How a filter of a string matches: the same value, a value that contains it ignoring the case, a value similar to it,
 * or one of several values.
 */
export type StringFilterMatch = 'equals' | 'iLike' | 'fuzzy' | 'oneOf';

/**
 * How a filter of a number or a date matches: the same value, one of several values, or a value between two bounds.
 */
export type RangeFilterMatch = 'equals' | 'oneOf' | 'range';

/**
 * How a filter of a boolean matches: the same value.
 */
export type BooleanFilterMatch = 'equals';

/**
 * How a filter of an array of values matches: an array that holds every value of the filter, or one that holds at
 * least one of them.
 */
export type ArrayFilterMatch = 'includes' | 'oneOf';

/**
 * Every way a filter of a single property matches.
 */
export type FilterMatch = StringFilterMatch | RangeFilterMatch | BooleanFilterMatch | ArrayFilterMatch;