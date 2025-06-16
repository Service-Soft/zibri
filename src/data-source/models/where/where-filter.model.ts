import { ArrayWhereFilter } from './array-where-filter.model';
import { BooleanWhereFilter } from './boolean-where-filter.model';
import { DateWhereFilter } from './date-where-filter.model';
import { NumberWhereFilter } from './number-where-filter.model';
import { ObjectWhereFilter } from './object-where-filter.model';
import { StringWhereFilter } from './string-where-filter.model';

export type Where<T extends Object> = WhereFilter<T> | WhereFilter<T>[];

export type WhereFilter<T extends Object> = {
    [P in keyof T]?: WhereFilterProperty<T[P]> | WhereFilterProperty<T[P]>[]
};

export type WhereFilterProperty<T> = T extends string
    ? StringWhereFilter
    : T extends number
        ? NumberWhereFilter
        : T extends boolean
            ? BooleanWhereFilter
            // eslint-disable-next-line typescript/no-explicit-any
            : T extends any[]
                ? ArrayWhereFilter<T[number]>
                : T extends Date
                    ? DateWhereFilter
                    : T extends object
                        ? ObjectWhereFilter<T>
                        : never;