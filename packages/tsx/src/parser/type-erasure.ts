/**
 * The result of splitting a module specifier into its path and client marker.
 */
export type ClientQuerySplit = {
    /**
     * The module specifier without a trailing `?client` query.
     */
    source: string,
    /**
     * Whether the specifier carried the `?client` marker.
     */
    client: boolean
};

/**
 * The decoded value of a `\u`/`\x` escape and how many characters it consumed.
 */
type UnicodeDecode = {
    /**
     * The decoded string value.
     */
    value: string,
    /**
     * The number of characters consumed after the escape introducer.
     */
    length: number
};

/**
 * Single-character escape sequences and the characters they decode to.
 */
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
    n: '\n',
    t: '\t',
    r: '\r',
    b: '\b',
    f: '\f',
    v: '\v',
    0: '\0'
};

/**
 * Splits a module specifier into its bare path and whether it carried a `?client` query.
 * The `?client` marker requests a browser vendor bundle and must be stripped from the path.
 * @param raw - The raw string literal value (without quotes), e.g. 'chart.js?client'.
 * @returns The bare source and whether the client marker was present.
 */
export function stripClientQuery(raw: string): ClientQuerySplit {
    if (raw.endsWith('?client')) {
        return { source: raw.slice(0, -'?client'.length), client: true };
    }
    return { source: raw, client: false };
}

/**
 * Decodes a JavaScript string literal (including its surrounding quotes) to its runtime value.
 * Handles the common escape sequences used in templates.
 * @param raw - The raw literal text including the surrounding quotes.
 * @returns The decoded string value.
 */
export function decodeStringLiteral(raw: string): string {
    if (raw.length < 2) {
        return raw;
    }
    const body: string = raw.slice(1, -1);
    let result: string = '';
    let i: number = 0;
    while (i < body.length) {
        const ch: string = body[i];
        if (ch !== '\\') {
            result += ch;
            i++;
            continue;
        }
        const decoded: UnicodeDecode = decodeEscape(body, i);
        result += decoded.value;
        i += decoded.length;
    }
    return result;
}

/**
 * Decodes the escape sequence starting at the backslash.
 * @param body - The string body (without surrounding quotes).
 * @param backslash - The index of the backslash.
 * @returns The decoded value and the number of characters the sequence occupied (including `\`).
 */
function decodeEscape(body: string, backslash: number): UnicodeDecode {
    const next: string = body[backslash + 1] ?? '';
    if (next === 'u') {
        const unicode: UnicodeDecode | undefined = decodeUnicodeEscape(body, backslash + 2);
        if (unicode) {
            return { value: unicode.value, length: 2 + unicode.length };
        }
    }
    if (next === 'x') {
        const hex: string = body.slice(backslash + 2, backslash + 4);
        if (/^[\dA-Fa-f]{2}$/.test(hex)) {
            return { value: String.fromCharCode(Number.parseInt(hex, 16)), length: 4 };
        }
    }
    return { value: SIMPLE_ESCAPES[next] ?? next, length: 2 };
}

/**
 * Decodes a `\u` escape starting after the `u`, supporting both `\uXXXX` and `\u{...}` forms.
 * @param body - The string body (without surrounding quotes).
 * @param at - The index just after the `u`.
 * @returns The decoded value and consumed length, or undefined when malformed.
 */
function decodeUnicodeEscape(body: string, at: number): UnicodeDecode | undefined {
    if (body[at] === '{') {
        const close: number = body.indexOf('}', at);
        if (close === -1) {
            return undefined;
        }
        const hex: string = body.slice(at + 1, close);
        if (!/^[\dA-Fa-f]+$/.test(hex)) {
            return undefined;
        }
        return { value: String.fromCodePoint(Number.parseInt(hex, 16)), length: close - at + 1 };
    }
    const hex: string = body.slice(at, at + 4);
    if (!/^[\dA-Fa-f]{4}$/.test(hex)) {
        return undefined;
    }
    return { value: String.fromCharCode(Number.parseInt(hex, 16)), length: 4 };
}