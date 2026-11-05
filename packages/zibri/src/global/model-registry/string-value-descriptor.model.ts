/**
 * Where the strings a property acts on sit in its value, and the settings each of them is acted on with.
 *
 * The value itself for a string property, each item for an array of them, and the value of a named shape
 * for a value of several shapes - nested as deep as the declaration nests them.
 */
export type StringValueDescriptor<TSettings> = {
    /**
     * The value is the string.
     */
    kind: 'string',
    /**
     * The settings it is acted on with.
     */
    settings: TSettings
} | {
    /**
     * The value is an array, and each item is described by `items`.
     */
    kind: 'items',
    /**
     * Where the strings sit in each item.
     */
    items: StringValueDescriptor<TSettings>
} | {
    /**
     * The value names one of several shapes, and the shapes that hold strings are described by name.
     */
    kind: 'shapes',
    /**
     * Where the strings sit in the value of each shape that holds any, by the name of the shape.
     */
    shapes: ReadonlyMap<string, StringValueDescriptor<TSettings>>
};

/**
 * One string a descriptor reaches in a value, with its settings.
 */
export type DescribedString<TSettings> = {
    /**
     * The string.
     */
    value: string,
    /**
     * The settings it is acted on with.
     */
    settings: TSettings
};