import { BaseWhereFilter } from './base-where-filter.model';

export type NumberWhereFilter = BaseWhereFilter<number> | {
    not?: number,
    oneOf?: number[],
    notOneOf?: number[],
    greaterThan?: number,
    greaterThanEquals?: number,
    lesserThan?: number,
    lesserThanEquals?: number
};