import { Where } from './where-filter.model';

export type ObjectWhereFilter<T extends Object> = null
    | { equals: T, where?: never, not?: never, oneOf?: never, notOneOf?: never }
    | { equals?: never, where: Where<T>, not?: never, oneOf?: never, notOneOf?: never }
    | { equals?: never, where?: never, not?: T, oneOf?: T[], notOneOf?: T[] };