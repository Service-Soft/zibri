import { type BaseEntity } from '../base-entity.model';

/**
 * The properties of a value a selection can name: every one that is not a method.
 */
type SelectableKeysOf<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown ? never : K
}[keyof T];

/**
 * What a selection reaches into below a property: the item of an array, the value otherwise.
 */
type SelectedInto<TValue> = NonNullable<TValue> extends readonly (infer TItem)[] ? NonNullable<TItem> : NonNullable<TValue>;

/**
 * Which part of a selection a property takes: `true` for the whole value, and for a value with
 * properties of its own - an object, a related entity, or an array of either - a selection of those.
 */
type SelectionBelow<TValue> = SelectedInto<TValue> extends Date
    ? true
    : SelectedInto<TValue> extends object ? true | EntitySelection<SelectedInto<TValue>> : true;

/**
 * Which properties a read hands back.
 *
 * The properties by name, `['name', 'email']`, or as an object that also reaches into what a property
 * holds: `{ name: true, address: { street: true } }`. Into a relation only when the read includes it.
 * An entity's `id` is always handed back, the related ones' included.
 */
export type EntitySelection<T> = readonly SelectableKeysOf<T>[] | {
    [K in SelectableKeysOf<T>]?: SelectionBelow<T[K]>
};

/**
 * The properties a selection names at its own level.
 */
type KeysNamedBy<S> = S extends readonly (infer K)[] ? K : keyof S;

/**
 * What a value is narrowed to by the part of a selection below it.
 */
type SelectedValue<TValue, TSelection> = TSelection extends true
    ? TValue
    : TValue extends readonly (infer TItem)[]
        ? Selected<TItem, TSelection>[]
        : TValue extends Date
            ? TValue
            : TValue extends object ? Selected<TValue, TSelection> : TValue;

/**
 * A value narrowed to what a selection names, the `id` of an entity included.
 */
export type Selected<T, S> = (T extends BaseEntity ? Pick<T, 'id'> : unknown) & {
    [K in keyof T as K extends KeysNamedBy<S> ? K : never]: S extends readonly unknown[]
        ? T[K]
        : SelectedValue<T[K], S[K & keyof S]>
};

/**
 * What a read hands back per entity: the whole entity, or what its selection names.
 */
export type Projected<T, S> = [S] extends [undefined] ? T : Selected<T, S>;