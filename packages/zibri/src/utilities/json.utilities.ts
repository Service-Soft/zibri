/**
 * The characters that make a string cost more than its utf-8 length: the two json escapes, the
 * control characters, and the surrogate range - where a lone half is written as an escape while a
 * whole pair is written as the character it forms.
 *
 * A string matching none of them is exactly its utf-8 length plus the two quotes, which the runtime
 * can measure without looking at it character by character.
 */
// oxlint-disable-next-line no-control-regex
const NEEDS_ESCAPING: RegExp = new RegExp('["\\\\\\u0000-\\u001F\\uD800-\\uDFFF]');

/**
 * The character codes json has a two character escape for. Everything else below the printable range
 * is written as \u00xx instead.
 */
const SHORT_ESCAPES: number[] = [0x08, 0x09, 0x0A, 0x0C, 0x0D];

/**
 * A value that says how it wants to be written as json, the way a Date does.
 */
type JsonSerializable = {
    /**
     * What json writes in place of the value itself.
     */
    toJSON: () => unknown
};

/**
 * How many utf-8 bytes a character below the printable range costs.
 * @param code - The character code.
 * @returns Two for the escapes json has a letter for, six for the rest.
 */
function controlByteSize(code: number): number {
    return SHORT_ESCAPES.includes(code) ? '\\n'.length : '\\u0000'.length;
}

/**
 * How many utf-8 bytes a character inside the basic plane costs.
 * @param code - The character code.
 * @returns One, two or three.
 */
function characterByteSize(code: number): number {
    if (code < 0x80) {
        return 1;
    }
    return code < 0x800 ? 2 : 3;
}

/**
 * Whether a character code is the second half of a surrogate pair.
 * @param code - The character code, which is NaN past the end of the string.
 * @returns True if the code completes a pair.
 */
function isTrailingSurrogate(code: number): boolean {
    return code >= 0xDC00 && code <= 0xDFFF;
}

/**
 * The size of the json form of a string, without building it.
 * @param value - The string to measure.
 * @returns The number of utf-8 bytes, quotes and escapes included.
 */
function stringByteSize(value: string): number {
    if (!NEEDS_ESCAPING.test(value)) {
        return Buffer.byteLength(value, 'utf8') + '""'.length;
    }

    let size: number = '""'.length;
    for (let i: number = 0; i < value.length; i++) {
        const code: number = value.charCodeAt(i);

        if (code === 0x22 || code === 0x5C) {
            size += '\\"'.length;
            continue;
        }
        if (code < 0x20) {
            size += controlByteSize(code);
            continue;
        }
        if (code < 0xD800 || code > 0xDFFF) {
            size += characterByteSize(code);
            continue;
        }
        // a whole pair is one code point and four bytes, a half on its own cannot be encoded at all
        // and is written as its escape instead
        if (code <= 0xDBFF && isTrailingSurrogate(value.charCodeAt(i + 1))) {
            size += 4;
            i++;
            continue;
        }
        size += '\\u0000'.length;
    }
    return size;
}

/**
 * The size of the json form of anything that is not an object or an array.
 * @param value - The value to measure.
 * @returns The number of utf-8 bytes, zero for the values json leaves out entirely, and undefined
 * for the values that have to be walked.
 */
function primitiveByteSize(value: unknown): number | undefined {
    switch (typeof value) {
        // first, because the replacer stringify is given turns one into a string before json sees it
        case 'bigint': {
            return stringByteSize(value.toString());
        }
        case 'string': {
            return stringByteSize(value);
        }
        case 'number': {
            return Number.isFinite(value) ? String(value).length : 'null'.length;
        }
        case 'boolean': {
            return value ? 'true'.length : 'false'.length;
        }
        case 'undefined':
        case 'function':
        case 'symbol': {
            return 0;
        }
        case 'object': {
            return value === null ? 'null'.length : undefined;
        }
    }
}

/**
 * The size of the json form of an object or an array, without building it.
 * @param value - The value to measure.
 * @param ancestors - The values currently being measured, to find a cycle the way stringify does.
 * @returns The number of utf-8 bytes.
 * @throws {TypeError} If the value refers back to itself.
 */
function containerByteSize(value: object, ancestors: Set<object>): number {
    if (ancestors.has(value)) {
        throw new TypeError('Converting circular structure to JSON');
    }
    ancestors.add(value);

    try {
        if (Array.isArray(value)) {
            // the separators, one fewer than there are elements
            let size: number = '[]'.length + Math.max(value.length - 1, 0);
            for (const element of value) {
                // an element json cannot write becomes null rather than disappearing, because
                // dropping it would move every element after it
                size += jsonByteSize(element, ancestors) || 'null'.length;
            }
            return size;
        }

        let size: number = '{}'.length;
        let written: number = 0;
        for (const [key, property] of Object.entries(value)) {
            const propertySize: number = jsonByteSize(property, ancestors);
            if (propertySize === 0) {
                continue;
            }
            size += stringByteSize(key) + ':'.length + propertySize;
            written++;
        }
        return size + Math.max(written - 1, 0);
    }
    finally {
        ancestors.delete(value);
    }
}

/**
 * The size of the json form of any value, without building it.
 *
 * Returns zero for the values json leaves out entirely, which is what lets a caller tell an omitted
 * object property from one that is written: nothing json does write is shorter than a single
 * character.
 * @param input - The value to measure.
 * @param ancestors - The values currently being measured, to find a cycle the way stringify does.
 * @returns The number of utf-8 bytes.
 * @throws {TypeError} If the value refers back to itself.
 */
function jsonByteSize(input: unknown, ancestors: Set<object>): number {
    const value: unknown = typeof input === 'object' && input != undefined
        && typeof (input as Partial<JsonSerializable>).toJSON === 'function'
        ? (input as JsonSerializable).toJSON()
        : input;

    return primitiveByteSize(value) ?? containerByteSize(value as object, ancestors);
}

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

    /**
     * Measures how many bytes {@link stringify} would write for a value, without writing them.
     *
     * The size is the one the string would have had, down to the byte - escapes, multi byte
     * characters and the properties json leaves out are all counted the way json counts them. For a
     * value of any size that costs a walk over it rather than a copy of it, which is the difference
     * between measuring a large value and materializing one.
     *
     * A value json writes nothing at all for - undefined, a function, a symbol - measures zero.
     * @param value - The value to measure.
     * @throws {TypeError} If a circular reference is found.
     * @returns The number of utf-8 bytes.
     */
    static byteSizeOf(value: unknown): number {
        return jsonByteSize(value, new Set());
    }
}