/**
 * Marks a reference as one `propertyOf` made.
 *
 * Declared and never assigned, so it exists only in the types: the one value carrying it is the one
 * `propertyOf` returns, which is what makes going through it the only way to write one down.
 */
declare const propertyReference: unique symbol;

/**
 * Stands for the value another property of the same row holds, which a filter compares a property
 * with. Written with `propertyOf`.
 */
export type PropertyReference<K extends string> = {
    /**
     * The property whose value is compared with.
     */
    readonly property: K,
    /**
     * Present in the type and in no value.
     */
    readonly [propertyReference]: true
};

/**
 * The properties of an entity that hold a value of the given kind, which a property of that kind can
 * be compared with.
 */
export type PropertiesHolding<T extends object, V> = {
    [K in keyof T]-?: NonNullable<T[K]> extends V ? K : never
}[keyof T] & string;
