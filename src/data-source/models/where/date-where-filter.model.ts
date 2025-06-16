import { BaseWhereFilter } from './base-where-filter.model';

export type DateWhereFilter = BaseWhereFilter<Date> | {
    not?: Date,
    oneOf?: Date[],
    notOneOf?: Date[],
    after?: Date,
    before?: Date
};