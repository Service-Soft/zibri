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
    items?: AccessShape,
    /**
     * Set when client code reads all other fields whole through a rest (`{ password, ...others }`): the
     * fields that rest leaves out.
     */
    restExcept?: string[]
};

/**
 * Which props of a component client code reads: the named ones, all of them, or all of them apart from
 * the ones a rest leaves out.
 */
export type ReferencedProps = string[] | 'all' | AllPropsExcept;

/**
 * All props of a component apart from some.
 */
export type AllPropsExcept = {
    /**
     * The props left out.
     */
    allExcept: string[]
};

/**
 * The part of a value that client code reads, ready to be written into the page.
 *
 * An array keeps its length, with each element narrowed to what is read from the elements, or left empty
 * when none is. An object keeps the fields read - read through getters, as client code would read them -
 * unless client code looks up its keys dynamically, in which case it stays whole. A `Date`, `Map` or `Set`
 * stays whole, as client code reads it through its methods. Any other value with a `toJSON` method is
 * narrowed by what that method returns, which is the form client code receives it in.
 * @param value - The value.
 * @param shape - What client code reads from it.
 * @returns The value, narrowed to the shape.
 */
export function projectValue(value: unknown, shape: AccessShape): unknown {
    // what client code reads of these are methods, which are no fields to narrow to: the value goes whole,
    // and the page gets it as what it is
    if (shape === 'whole' || value instanceof Date || value instanceof Map || value instanceof Set) {
        return value;
    }
    const serialized: unknown = serializesItself(value) ? value.toJSON() : value;
    if (typeof serialized !== 'object' || serialized === null) {
        return serialized;
    }
    if (Array.isArray(serialized)) {
        const items: AccessShape | undefined = shape.items;
        return shape.restExcept === undefined
            ? serialized.map((element: unknown) => items === undefined ? null : projectValue(element, items))
            : serialized;
    }
    if (shape.items !== undefined) {
        return serialized;
    }
    const projected: Record<string, unknown> = {};
    for (const field of Object.keys(serialized).filter(key => shape.restExcept?.includes(key) === false)) {
        projected[field] = Reflect.get(serialized, field);
    }
    for (const [field, fieldShape] of Object.entries(shape.fields)) {
        if (field in serialized) {
            projected[field] = projectValue(Reflect.get(serialized, field), fieldShape);
        }
    }
    return projected;
}

/**
 * What client code reads of a value in two places together.
 * @param first - What one place reads, if anything.
 * @param second - What the other place reads.
 * @returns Both, a value read whole in either being read whole.
 */
export function mergeAccessShapes(first: AccessShape | undefined, second: AccessShape): AccessShape {
    if (first === undefined) {
        return second;
    }
    if (first === 'whole' || second === 'whole') {
        return 'whole';
    }
    const fields: Record<string, AccessShape> = { ...first.fields };
    for (const [field, read] of Object.entries(second.fields)) {
        fields[field] = mergeAccessShapes(fields[field], read);
    }
    const items: AccessShape | undefined = second.items === undefined ? first.items : mergeAccessShapes(first.items, second.items);
    const restExcept: string[] | undefined = mergeRestExcept(first.restExcept, second.restExcept);
    return {
        fields,
        ...items === undefined ? {} : { items },
        ...restExcept === undefined ? {} : { restExcept }
    };
}

/**
 * What client code reads of a value through a rest of it.
 * @param read - What client code reads from the rest.
 * @param except - The fields the rest leaves out.
 * @returns What that reads of the value itself.
 */
export function resolveAccessThroughRest(read: AccessShape, except: string[]): AccessShape {
    if (read === 'whole') {
        return { fields: {}, restExcept: except };
    }
    // a rest of this rest leaves out its own fields on top of the ones this rest does
    return read.restExcept === undefined ? read : { ...read, restExcept: [...read.restExcept, ...except] };
}

/**
 * The fields two reads through a rest both leave out: a field either of them reads is read.
 * @param first - What one read leaves out, if it goes through a rest.
 * @param second - What the other read leaves out, if it goes through a rest.
 * @returns The fields left out, or undefined when neither read goes through a rest.
 */
function mergeRestExcept(first: string[] | undefined, second: string[] | undefined): string[] | undefined {
    return first === undefined || second === undefined ? first ?? second : first.filter(field => second.includes(field));
}

/**
 * Whether a value decides its own serialization.
 * @param value - The value.
 * @returns True when it has a `toJSON` method.
 */
function serializesItself(value: unknown): value is SelfSerializing {
    return typeof value === 'object' && value !== null && 'toJSON' in value && typeof value.toJSON === 'function';
}

/**
 * A value that decides its own serialization.
 */
type SelfSerializing = {
    /**
     * What the value serializes as.
     */
    toJSON: () => unknown
};