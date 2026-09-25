import { ArrayWhereFilter, ObjectArrayWhereFilter } from './array-where-filter.model';
import { BooleanWhereFilter } from './boolean-where-filter.model';
import { DateWhereFilter } from './date-where-filter.model';
import { AnyNumber, NumberWhereFilter } from './number-where-filter.model';
import { ObjectWhereFilter } from './object-where-filter.model';
import { IsOneOf, NamedShapeValue, OneOfWhereFilter } from './one-of-where-filter.model';
import { StringWhereFilter } from './string-where-filter.model';
import { BigNumber } from '../../../utilities/number.utilities';

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
 *
 * Distributes over the members of `T`, while `Whole` keeps all of them: a value of several shapes is
 * a union of one member per shape, and its filter is built from every shape at once.
 */
export type WhereFilterProperty<T, Whole = T> = T extends NamedShapeValue
    ? IsOneOf<Whole> extends true
        ? OneOfWhereFilter<Extract<NonNullable<Whole>, NamedShapeValue>> | null
        : ObjectWhereFilter<T>
    : SingleShapeWhereFilterProperty<T>;

/**
 * The definition for a single where filter property that is not a value of several shapes.
 */
type SingleShapeWhereFilterProperty<T> = T extends bigint
    ? NumberWhereFilter<bigint>
    : T extends string
        ? StringWhereFilter
        : T extends number
            ? NumberWhereFilter<number>
            : T extends boolean
                ? BooleanWhereFilter
                : T extends (infer ItemType)[]
                    ? IsOneOf<ItemType> extends true
                        ? ArrayWhereFilter<ItemType>
                        : ItemType extends Date
                            ? ArrayWhereFilter<ItemType>
                            : ItemType extends object
                                ? ObjectArrayWhereFilter<ItemType>
                                : ArrayWhereFilter<ItemType>
                    : T extends Date
                        ? DateWhereFilter
                        // before the object branch, which a BigNumber would otherwise fall into and
                        // be filtered by the fields it happens to be built out of
                        : T extends BigNumber
                            ? NumberWhereFilter<AnyNumber>
                            : T extends object
                                ? ObjectWhereFilter<T>
                                : never;