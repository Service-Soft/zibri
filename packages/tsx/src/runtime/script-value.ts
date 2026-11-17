/**
 * The characters escaped inside a string: `<`, so that no string can start or end markup the html parser
 * acts on inside a script, and the line and paragraph separators, which older javascript does not take
 * inside a string. Written by their codes, so no tool rewriting escape sequences can turn them into the
 * characters themselves.
 */
const ESCAPED_CHARACTERS: RegExp = new RegExp(`[${String.fromCodePoint(0x3C, 0x20_28, 0x20_29)}]`, 'g');

/**
 * Writes a value as javascript source that can be placed inside an inline `<script>`, so the page reads the
 * same value: a `Date`, `Map` or `Set` as one, and `undefined`, `NaN`, the infinities, `-0` and a `bigint`
 * as themselves. A value json can hold is written as json writes it.
 *
 * The writer knows a fixed list of what it writes, and never the source of a function: a function or a
 * symbol is left out of an object, `null` in an array and `undefined` elsewhere, as json does. A value
 * with a `toJSON` method is written as what that returns, and any other object as a plain object of its own
 * enumerable fields, without its class.
 *
 * Every `<` in a string is written as an escape, which is the same character to javascript and no
 * character to the html parser: a string holding `</script>` or `<!--` in any spelling cannot end the
 * element or change how it is read.
 * @param value - The value.
 * @returns The javascript source of the value.
 * @throws A TypeError when the value contains itself.
 */
export function toScriptValue(value: unknown): string {
    return writeValue(value, new Set()) ?? 'undefined';
}

/**
 * Writes a value, or nothing for one that is left out.
 * @param value - The value.
 * @param ancestors - The objects the value is inside of, to refuse one that contains itself.
 * @returns The source, or undefined for a function or a symbol.
 * @throws A TypeError when the value contains itself.
 */
function writeValue(value: unknown, ancestors: Set<object>): string | undefined {
    switch (typeof value) {
        case 'undefined': {
            return 'undefined';
        }
        case 'boolean': {
            return String(value);
        }
        case 'number': {
            return Object.is(value, -0) ? '-0' : String(value);
        }
        case 'bigint': {
            return `${value}n`;
        }
        case 'string': {
            return writeString(value);
        }
        case 'function':
        case 'symbol': {
            return undefined;
        }
        case 'object': {
            if (value === null) {
                return 'null';
            }
            if (ancestors.has(value)) {
                throw new TypeError('A value written into the page contains itself.');
            }
            ancestors.add(value);
            try {
                return writeObject(value, ancestors);
            }
            finally {
                ancestors.delete(value);
            }
        }
    }
}

/**
 * Writes an object.
 * @param value - The object.
 * @param ancestors - The objects the object is inside of.
 * @returns The source.
 */
function writeObject(value: object, ancestors: Set<object>): string | undefined {
    if (value instanceof Date) {
        return `new Date(${value.getTime()})`;
    }
    if (value instanceof Map) {
        const entries: string[] = [...value.entries()].map(([key, entry]: [unknown, unknown]) => {
            const writtenKey: string = writeValue(key, ancestors) ?? 'undefined';
            const writtenEntry: string = writeValue(entry, ancestors) ?? 'undefined';
            return `[${writtenKey},${writtenEntry}]`;
        });
        return `new Map([${entries.join(',')}])`;
    }
    if (value instanceof Set) {
        return `new Set([${[...value.values()].map((entry: unknown) => writeValue(entry, ancestors) ?? 'undefined').join(',')}])`;
    }
    if (Array.isArray(value)) {
        return `[${Array.from(value, (entry: unknown) => writeValue(entry, ancestors) ?? 'null').join(',')}]`;
    }
    if ('toJSON' in value && typeof value.toJSON === 'function') {
        return writeValue((value.toJSON as () => unknown)(), ancestors);
    }
    const fields: string[] = Object.keys(value).flatMap(key => {
        const field: string | undefined = writeValue(Reflect.get(value, key), ancestors);
        return field === undefined ? [] : [`${writeString(key)}:${field}`];
    });
    return `{${fields.join(',')}}`;
}

/**
 * Writes a string as a javascript string literal, its `<` and line and paragraph separators escaped.
 * @param value - The string.
 * @returns The literal.
 */
function writeString(value: string): string {
    return JSON.stringify(value).replaceAll(
        ESCAPED_CHARACTERS,
        character => `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`
    );
}