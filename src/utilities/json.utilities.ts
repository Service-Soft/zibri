/**
 * Utilities for handling json.
 */
export abstract class JsonUtilities {
    /**
     * Converts a JavaScript Object Notation (JSON) string into an object.
     * @param value - A valid JSON string.
     * @param reviver - A function that transforms the results. This function is called for each member of the object.
     * If a member contains nested objects, the nested objects are transformed before the parent object is.
     * @throws {SyntaxError} If `text` is not valid JSON.
     * @returns The parsed object.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    static parse<T>(value: string, reviver?: (this: any, key: string, value: unknown) => unknown): T {
        return JSON.parse(value, reviver) as T;
    }

    /**
     * Converts a JavaScript value to a JavaScript Object Notation (JSON) string.
     * @param value - A JavaScript value, usually an object or array, to be converted.
     * @param replacer - A function that transforms the results.
     * @param space - Adds indentation, white space, and line break characters to the return-value JSON text to make it easier to read.
     * @throws {TypeError} If a circular reference is found.
     * @returns A json string.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    static stringify<T>(value: T, replacer?: (this: any, key: string, value: unknown) => unknown, space?: string | number): string {
        return JSON.stringify(
            value,
            (_key, value: unknown) => {
                const res: unknown = typeof value === 'bigint' ? value.toString() : value;
                return replacer ? replacer(_key, res) : res;
            },
            space
        );
    }
}