/**
 * The properties a list of `T` may be ordered by: `true` for a value, nested like the model for the properties of an
 * object or of a relation to one row. An array, and a relation to many rows, hold several values per row, so nothing
 * orders by them.
 * @example
 * export const taskOrder = { dueAt: true, address: { city: true }, team: { name: true } } as const satisfies OrderConfig<Task>;
 */
export type OrderConfig<T> = {
    [K in keyof T]?: OrderConfigOf<NonNullable<T[K]>>
};

/**
 * Whether a list may be ordered by a value of type `V`, or by which properties inside it.
 */
type OrderConfigOf<V> = V extends readonly unknown[]
    ? never
    : V extends Date | string | number | bigint | boolean
        ? true
        : V extends object
            ? OrderConfig<V>
            : never;