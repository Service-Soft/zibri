import { BaseWhereFilter } from './base-where-filter.model';

export type StringWhereFilter = BaseWhereFilter<string> | {
    not?: string,
    oneOf?: string[],
    notOneOf?: string[],
    like?: string,
    iLike?: string
};