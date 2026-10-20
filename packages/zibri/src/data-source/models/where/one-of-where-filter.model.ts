import { WhereFilterProperty } from './where-filter.model.ts';

/**
 * A value that names which of several shapes it is, as the filter types see it.
 */
export type NamedShapeValue = {
    /**
     * The name of the shape.
     */
    shape: string,
    /**
     * The value.
     */
    value: unknown
};

/**
 * Whether a type is a value of several named shapes, rather than an object that happens to have a
 * `shape` and a `value`: its names are known, where such an object's are any text.
 */
// the name is inferred rather than read as `T['shape']`: a filter of a generic entity is compared
// against another instantiation of this type, which needs the right side of each `extends` to be the
// same type in both - and `T['shape']` is a different one per instantiation
// eslint-disable-next-line jsdoc-js/require-jsdoc
export type IsOneOf<T> = [T] extends [{ shape: infer Name, value: unknown } | null | undefined]
    ? [string] extends [Name] ? false : true
    : false;

/**
 * A filter for a value of several named shapes.
 *
 * Names every shape as `when` followed by its name, and a value is matched by the filter of the shape
 * it names. `false` matches no value of that shape, and an empty filter every one.
 */
export type OneOfWhereFilter<T extends NamedShapeValue> = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    [Name in T['shape'] as `when${Capitalize<Name>}`]: WhereFilterProperty<Extract<T, { shape: Name }>['value']> | false
};