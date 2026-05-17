import { ArrayWhereFilter, ObjectArrayWhereFilter } from './array-where-filter.model';
import { BooleanWhereFilter } from './boolean-where-filter.model';
import { DateWhereFilter } from './date-where-filter.model';
import { NumberWhereFilter } from './number-where-filter.model';
import { ObjectWhereFilter } from './object-where-filter.model';
import { StringWhereFilter } from './string-where-filter.model';

/**
 * The type for a where property. Can either be a single where filter or an array of where filters.
 */
export type Where<T extends Object> = WhereFilter<T> | WhereFilter<T>[];

/**
 * A single where filter.
 */
export type WhereFilter<T extends Object> = {
    [P in keyof T]?: WhereFilterProperty<T[P]> | WhereFilterProperty<T[P]>[]
};

/**
 * The definition for a single where filter property.
 */
export type WhereFilterProperty<T> = T extends bigint
    ? NumberWhereFilter<bigint>
    : T extends string
        ? StringWhereFilter
        : T extends number
            ? NumberWhereFilter<number>
            : T extends boolean
                ? BooleanWhereFilter
                : T extends (infer ItemType)[]
                    ? ItemType extends Date
                        ? ArrayWhereFilter<ItemType>
                        : ItemType extends object
                            ? ObjectArrayWhereFilter<ItemType>
                            : ArrayWhereFilter<ItemType>
                    : T extends Date
                        ? DateWhereFilter
                        : T extends object
                            ? ObjectWhereFilter<T>
                            : never;