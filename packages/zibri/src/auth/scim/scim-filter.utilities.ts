import { ScimErrorType } from './scim-error-type.enum.ts';
import { ScimAttributePath, ScimComparisonOperator, ScimFilter, ScimFilterValue } from './scim-filter.model.ts';
import { ScimSchema } from './scim-schema.enum.ts';
import { ScimError } from './scim.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * A piece of a filter's text.
 */
type Token = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    kind: '(' | ')' | '[' | ']'
} | {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    kind: 'string',
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    value: string
} | {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    kind: 'word',
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    text: string
};

/**
 * Where reading a filter has got to.
 */
type ParseState = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    tokens: Token[],
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    position: number
};

const COMPARISON_OPERATORS: ScimComparisonOperator[] = ['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'lt', 'ge', 'le'];

const ATTRIBUTE_NAME: RegExp = /^[A-Za-z][\w$-]*$/;

/**
 * Reads SCIM filters (RFC 7644, 3.4.2.2) and the attribute paths they and patch operations name, and
 * tells whether a resource matches one.
 */
export abstract class ScimFilterUtilities {
    /**
     * Reads a filter.
     * @param text - The filter, eg. `userName eq "anna@example.com" and active eq true`.
     * @returns What it says.
     * @throws A ScimError (invalidFilter) when it is not a filter.
     */
    static parse(text: string): ScimFilter {
        const state: ParseState = { tokens: this.tokenize(text), position: 0 };
        const filter: ScimFilter = this.parseOr(state);
        if (state.position < state.tokens.length) {
            throw this.invalidFilter(text);
        }
        return filter;
    }

    /**
     * Reads the attribute path a filter or a patch operation names.
     * @param text - The path, eg. `name.givenName`, or one prefixed by the schema of an extension.
     * @param errorType - What is wrong when it is not a path: a filter's or a patch's.
     * @returns The path.
     * @throws A ScimError of the given type when it is not an attribute path.
     */
    static parseAttributePath(text: string, errorType: ScimErrorType): ScimAttributePath {
        let uri: string | undefined = undefined;
        let rest: string = text;
        // the schema ends at the last colon: it holds dots of its own, eg. "2.0"
        if (/^urn:/i.test(text)) {
            const separator: number = text.lastIndexOf(':');
            uri = text.slice(0, separator);
            rest = text.slice(separator + 1);
            // a core attribute may be named with its schema too, which says nothing more
            if ([ScimSchema.USER, ScimSchema.GROUP].some(schema => schema.toLowerCase() === uri?.toLowerCase())) {
                uri = undefined;
            }
        }
        const [attribute = '', subAttribute, ...more] = rest.split('.');
        if (!ATTRIBUTE_NAME.test(attribute) || more.length || (subAttribute != undefined && !ATTRIBUTE_NAME.test(subAttribute))) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`"${text}" is not an attribute path.`, errorType);
        }
        return { uri, attribute, subAttribute };
    }

    /**
     * Whether a resource, or an item of a multi-valued attribute, matches a filter. Text is compared
     * without regard to case.
     * @param filter - The filter.
     * @param resource - The resource or item.
     * @returns True when it matches.
     */
    static matches(filter: ScimFilter, resource: Record<string, unknown>): boolean {
        switch (filter.type) {
            case 'and': {
                return this.matches(filter.left, resource) && this.matches(filter.right, resource);
            }
            case 'or': {
                return this.matches(filter.left, resource) || this.matches(filter.right, resource);
            }
            case 'not': {
                return !this.matches(filter.filter, resource);
            }
            case 'present': {
                return this.resolveValues(resource, filter.path, false)
                    .some(value => value != undefined && value !== '' && !(Array.isArray(value) && !value.length));
            }
            case 'comparison': {
                return this.resolveValues(resource, filter.path, true).some(value => this.compare(value, filter.operator, filter.value));
            }
            case 'valuePath': {
                const items: unknown[] = this.toArray(this.findAttribute(this.findContainer(resource, filter.path), filter.path.attribute));
                return items.some(item => this.isRecord(item) && this.matches(filter.filter, item));
            }
        }
    }

    /**
     * Finds the value of an attribute, whose name SCIM compares without regard to case.
     * @param record - The object holding it.
     * @param name - The name of the attribute.
     * @returns The key it is stored under, or undefined when the object has none.
     */
    static findKey(record: Record<string, unknown>, name: string): string | undefined {
        return Object.keys(record).find(key => key.toLowerCase() === name.toLowerCase());
    }

    /**
     * Whether a value is a plain object.
     * @param value - The value.
     * @returns True for an object that is not an array.
     */
    static isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value != undefined && !Array.isArray(value);
    }

    /**
     * The values an attribute path points at: every item of a multi-valued attribute, and of a complex
     * one the sub-attribute it names.
     * @param resource - The resource.
     * @param path - The path.
     * @param compared - Whether the values are compared with one, which a complex value without a named
     * sub-attribute is by its `value`, as `emails eq "a@b.c"` is.
     * @returns The values.
     */
    private static resolveValues(resource: Record<string, unknown>, path: ScimAttributePath, compared: boolean): unknown[] {
        const items: unknown[] = this.toArray(this.findAttribute(this.findContainer(resource, path), path.attribute));
        return items.map(item => {
            if (!this.isRecord(item)) {
                return item;
            }
            if (path.subAttribute != undefined) {
                return this.findAttribute(item, path.subAttribute);
            }
            return compared ? this.findAttribute(item, 'value') : item;
        });
    }

    private static findContainer(resource: Record<string, unknown>, path: ScimAttributePath): Record<string, unknown> {
        if (path.uri == undefined) {
            return resource;
        }
        const extension: unknown = this.findAttribute(resource, path.uri);
        return this.isRecord(extension) ? extension : {};
    }

    private static findAttribute(record: Record<string, unknown>, name: string): unknown {
        const key: string | undefined = this.findKey(record, name);
        return key == undefined ? undefined : record[key];
    }

    private static toArray(value: unknown): unknown[] {
        if (value == undefined) {
            return [];
        }
        return Array.isArray(value) ? value : [value];
    }

    private static compare(actual: unknown, operator: ScimComparisonOperator, expected: ScimFilterValue): boolean {
        switch (operator) {
            case 'eq': {
                return this.isEqual(actual, expected);
            }
            case 'ne': {
                return !this.isEqual(actual, expected);
            }
            case 'co':
            case 'sw':
            case 'ew': {
                return typeof actual === 'string'
                    && typeof expected === 'string'
                    && this.compareText(actual.toLowerCase(), operator, expected.toLowerCase());
            }
            case 'gt':
            case 'lt':
            case 'ge':
            case 'le': {
                return this.compareOrder(this.resolveDifference(actual, expected), operator);
            }
        }
    }

    private static isEqual(actual: unknown, expected: ScimFilterValue): boolean {
        if (expected == undefined) {
            return actual == undefined;
        }
        if (typeof actual === 'string' && typeof expected === 'string') {
            return actual.toLowerCase() === expected.toLowerCase();
        }
        return actual === expected;
    }

    private static compareText(left: string, operator: 'co' | 'sw' | 'ew', right: string): boolean {
        switch (operator) {
            case 'co': {
                return left.includes(right);
            }
            case 'sw': {
                return left.startsWith(right);
            }
            case 'ew': {
                return left.endsWith(right);
            }
        }
    }

    /**
     * How far apart two values are in order: numbers by their difference, text by where it sorts.
     * @param actual - The value of the resource.
     * @param expected - The value of the filter.
     * @returns Above 0 when the resource's value comes after, NaN when the two cannot be ordered.
     */
    private static resolveDifference(actual: unknown, expected: ScimFilterValue): number {
        if (typeof actual === 'number' && typeof expected === 'number') {
            return actual - expected;
        }
        if (typeof actual === 'string' && typeof expected === 'string') {
            const left: string = actual.toLowerCase();
            const right: string = expected.toLowerCase();
            if (left === right) {
                return 0;
            }
            return left > right ? 1 : -1;
        }
        return Number.NaN;
    }

    private static compareOrder(difference: number, operator: 'gt' | 'lt' | 'ge' | 'le'): boolean {
        switch (operator) {
            case 'gt': {
                return difference > 0;
            }
            case 'lt': {
                return difference < 0;
            }
            case 'ge': {
                return difference >= 0;
            }
            case 'le': {
                return difference <= 0;
            }
        }
    }

    private static parseOr(state: ParseState): ScimFilter {
        let left: ScimFilter = this.parseAnd(state);
        while (this.isKeyword(state.tokens[state.position], 'or')) {
            state.position++;
            left = { type: 'or', left, right: this.parseAnd(state) };
        }
        return left;
    }

    private static parseAnd(state: ParseState): ScimFilter {
        let left: ScimFilter = this.parseUnary(state);
        while (this.isKeyword(state.tokens[state.position], 'and')) {
            state.position++;
            left = { type: 'and', left, right: this.parseUnary(state) };
        }
        return left;
    }

    private static parseUnary(state: ParseState): ScimFilter {
        const token: Token | undefined = state.tokens[state.position++];
        if (token?.kind === '(') {
            return this.parseGroup(state);
        }
        if (token?.kind !== 'word') {
            throw this.invalidFilter(this.describe(token));
        }
        if (token.text.toLowerCase() === 'not' && state.tokens[state.position]?.kind === '(') {
            state.position++;
            return { type: 'not', filter: this.parseGroup(state) };
        }
        return this.parseAttributeExpression(state, this.parseAttributePath(token.text, ScimErrorType.INVALID_FILTER));
    }

    /**
     * Reads what follows an attribute path: a filter of its items in brackets, `pr`, or a comparison.
     * @param state - Where reading has got to, just past the path.
     * @param path - The path.
     * @returns The filter.
     * @throws A ScimError (invalidFilter) when neither follows.
     */
    private static parseAttributeExpression(state: ParseState, path: ScimAttributePath): ScimFilter {
        if (state.tokens[state.position]?.kind === '[') {
            state.position++;
            const filter: ScimFilter = this.parseOr(state);
            this.expect(state, ']');
            return { type: 'valuePath', path, filter };
        }
        const operatorToken: Token | undefined = state.tokens[state.position++];
        const operator: string = operatorToken?.kind === 'word' ? operatorToken.text.toLowerCase() : '';
        if (operator === 'pr') {
            return { type: 'present', path };
        }
        const comparison: ScimComparisonOperator | undefined = COMPARISON_OPERATORS.find(o => o === operator);
        if (comparison == undefined) {
            throw this.invalidFilter(this.describe(operatorToken));
        }
        return { type: 'comparison', path, operator: comparison, value: this.parseValue(state.tokens[state.position++]) };
    }

    private static parseGroup(state: ParseState): ScimFilter {
        const filter: ScimFilter = this.parseOr(state);
        this.expect(state, ')');
        return filter;
    }

    private static parseValue(token: Token | undefined): ScimFilterValue {
        if (token?.kind === 'string') {
            return token.value;
        }
        if (token?.kind === 'word') {
            switch (token.text) {
                case 'true': {
                    return true;
                }
                case 'false': {
                    return false;
                }
                case 'null': {
                    // the filter's own null, which asks for an attribute without a value
                    // eslint-disable-next-line unicorn/no-null
                    return null;
                }
            }
            const value: number = Number(token.text);
            if (token.text.length && Number.isFinite(value)) {
                return value;
            }
        }
        throw this.invalidFilter(this.describe(token));
    }

    private static expect(state: ParseState, kind: ')' | ']'): void {
        const token: Token | undefined = state.tokens[state.position++];
        if (token?.kind !== kind) {
            throw this.invalidFilter(this.describe(token));
        }
    }

    private static isKeyword(token: Token | undefined, keyword: string): boolean {
        return token?.kind === 'word' && token.text.toLowerCase() === keyword;
    }

    private static tokenize(text: string): Token[] {
        const tokens: Token[] = [];
        let i: number = 0;
        while (i < text.length) {
            if (/\s/.test(text.charAt(i))) {
                i++;
                continue;
            }
            const end: number = this.findTokenEnd(text, i);
            tokens.push(this.toToken(text.slice(i, end)));
            i = end;
        }
        return tokens;
    }

    /**
     * Finds where the piece of a filter's text that starts at a position ends.
     * @param text - The filter.
     * @param start - Where the piece starts.
     * @returns The position just past it.
     */
    private static findTokenEnd(text: string, start: number): number {
        const char: string = text.charAt(start);
        if ('()[]'.includes(char)) {
            return start + 1;
        }
        let end: number = start + 1;
        if (char === '"') {
            while (end < text.length && text.charAt(end) !== '"') {
                end += text.charAt(end) === '\\' ? 2 : 1;
            }
            return end + 1;
        }
        while (end < text.length && !/[\s"()[\]]/.test(text.charAt(end))) {
            end++;
        }
        return end;
    }

    private static toToken(piece: string): Token {
        if (piece === '(' || piece === ')' || piece === '[' || piece === ']') {
            return { kind: piece };
        }
        if (piece.startsWith('"')) {
            return { kind: 'string', value: this.parseString(piece) };
        }
        return { kind: 'word', text: piece };
    }

    /**
     * Reads a string of a filter, which is written as a json string.
     * @param quoted - The string, quotes included.
     * @returns The string.
     * @throws A ScimError (invalidFilter) when it is not a json string.
     */
    private static parseString(quoted: string): string {
        try {
            const value: unknown = JSON.parse(quoted);
            if (typeof value === 'string') {
                return value;
            }
        }
        catch {
            // the error below says what was wrong
        }
        throw this.invalidFilter(quoted);
    }

    private static describe(token: Token | undefined): string {
        if (token == undefined) {
            return 'the end';
        }
        switch (token.kind) {
            case 'string': {
                return `"${token.value}"`;
            }
            case 'word': {
                return token.text;
            }
            case '(':
            case ')':
            case '[':
            case ']': {
                return token.kind;
            }
        }
    }

    private static invalidFilter(near: string): ScimError {
        return new ScimError(HttpStatus.BAD_REQUEST, $ts`The filter cannot be read at ${near}.`, ScimErrorType.INVALID_FILTER);
    }
}