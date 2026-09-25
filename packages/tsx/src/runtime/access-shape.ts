/**
 * What client code reads from a value: the value whole, or some of its fields and, for an array, some of
 * its elements. The compiler works it out; the render writes only that much of the value into the page.
 */
export type AccessShape = 'whole' | FieldAccess;

/**
 * The parts of a value client code reads.
 */
export type FieldAccess = {
    /**
     * The fields read, each with what is read from it.
     */
    fields: Record<string, AccessShape>,
    /**
     * What is read from each element, when the value is an array whose elements client code reads.
     */
    items?: AccessShape
};

/**
 * The part of a value that client code reads, ready to be written into the page.
 *
 * A primitive is itself, and so is anything that serializes itself (a `Date`). An array keeps its
 * length, with each element narrowed to what is read from the elements, or left empty when none is. An
 * object keeps the fields read - read through getters, as client code would read them - unless client
 * code looks up its keys dynamically, in which case it stays whole.
 * @param value - The value.
 * @param shape - What client code reads from it.
 * @returns The value, narrowed to the shape.
 */
export function projectValue(value: unknown, shape: AccessShape): unknown {
    if (shape === 'whole' || typeof value !== 'object' || value === null || serializesItself(value)) {
        return value;
    }
    if (Array.isArray(value)) {
        const items: AccessShape | undefined = shape.items;
        // eslint-disable-next-line unicorn/no-null
        return value.map((element: unknown) => items === undefined ? null : projectValue(element, items));
    }
    if (shape.items !== undefined) {
        return value;
    }
    const projected: Record<string, unknown> = {};
    for (const [field, fieldShape] of Object.entries(shape.fields)) {
        if (field in value) {
            projected[field] = projectValue(Reflect.get(value, field), fieldShape);
        }
    }
    return projected;
}

/**
 * Whether a value decides its own serialization.
 * @param value - The value.
 * @returns True when it has a `toJSON` method.
 */
function serializesItself(value: object): boolean {
    return 'toJSON' in value && typeof value.toJSON === 'function';
}