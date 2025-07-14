import { Where } from './where-filter.model';

/**
 * A filter for a object where property.
 */
export type ObjectWhereFilter<T extends Object> = null
    // eslint-disable-next-line jsdoc/require-jsdoc
    | { equals: T, where?: never, not?: never, oneOf?: never, notOneOf?: never }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | { equals?: never, where: Where<T>, not?: never, oneOf?: never, notOneOf?: never }
    // eslint-disable-next-line jsdoc/require-jsdoc
    | { equals?: never, where?: never, not?: T, oneOf?: T[], notOneOf?: T[] };