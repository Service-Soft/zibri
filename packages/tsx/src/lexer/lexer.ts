import { KEYWORDS, Token, TokenType } from './token.model';

/**
 * A saved lexer position, used by the parser for lookahead/rewind.
 */
export type LexerMark = {
    /**
     * The saved cursor offset.
     */
    pos: number,
    /**
     * The previous significant token at the time of the mark (drives regex detection).
     */
    prev: Token | undefined
};

/**
 * Keywords after which a `/` starts a division rather than a regex literal.
 */
const VALUE_KEYWORDS: ReadonlySet<string> = new Set<string>(['this', 'super', 'true', 'false', 'null', 'undefined']);

/**
 * Multi-character punctuators, ordered longest-first so the scanner matches greedily.
 */
const PUNCTUATORS: readonly string[] = [
    '>>>=',
    '...',
    '===',
    '!==',
    '**=',
    '<<=',
    '>>=',
    '>>>',
    '&&=',
    '||=',
    '??=',
    '=>',
    '<=',
    '>=',
    '==',
    '!=',
    '+=',
    '-=',
    '*=',
    '/=',
    '%=',
    '&=',
    '|=',
    '^=',
    '**',
    '++',
    '--',
    '<<',
    '>>',
    '&&',
    '||',
    '??',
    '?.',
    '{',
    '}',
    '(',
    ')',
    '[',
    ']',
    ';',
    ',',
    '<',
    '>',
    '+',
    '-',
    '*',
    '/',
    '%',
    '&',
    '|',
    '^',
    '!',
    '~',
    '?',
    ':',
    '.',
    '='
];

// eslint-disable-next-line jsdoc/require-jsdoc
function isIdentifierStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z')
        || (ch >= 'A' && ch <= 'Z')
        || ch === '_' || ch === '$'
        || ch.charCodeAt(0) > 127;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isIdentifierPart(ch: string): boolean {
    return isIdentifierStart(ch) || isDigit(ch);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isWhitespace(ch: string): boolean {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'
        || ch === '\f' || ch === '\v' || ch === ' ' || ch === '﻿';
}

/**
 * A hand-written, parser-driven lexer for the supported TSX dialect.
 *
 * The main {@link Lexer.next} method scans code-mode tokens. Context-sensitive constructs
 * are exposed as explicit methods the parser calls at the right moment:
 * {@link Lexer.scanJsxText} for JSX child text and {@link Lexer.scanTemplateContinuation}
 * for template middle/tail segments after a `${...}` substitution.
 */
export class Lexer {
    /**
     * When true, a `/` is always scanned as a punctuator rather than a regex/division. The parser
     * enables this while scanning JSX opening/closing tags (where `/>` and `</` occur) and disables
     * it inside `{...}` expression containers.
     */
    jsxTag: boolean = false;

    private pos: number = 0;
    private prevSignificant: Token | undefined = undefined;

    constructor(private readonly source: string) {}

    /**
     * The current cursor offset.
     * @returns The 0-based offset into the source.
     */
    get position(): number {
        return this.pos;
    }

    /**
     * Saves the current position for later rewind.
     * @returns A mark that can be passed to {@link Lexer.reset}.
     */
    mark(): LexerMark {
        return { pos: this.pos, prev: this.prevSignificant };
    }

    /**
     * Restores a previously saved position.
     * @param mark - A mark produced by {@link Lexer.mark}.
     */
    reset(mark: LexerMark): void {
        this.pos = mark.pos;
        this.prevSignificant = mark.prev;
    }

    /**
     * Scans and returns the next code-mode token, advancing the cursor past it.
     * Whitespace and comments are skipped.
     * @returns The next token, or an EOF token at end of input.
     */
    next(): Token {
        this.skipTrivia();
        const start: number = this.pos;
        if (start >= this.source.length) {
            return this.make(TokenType.EOF, start, start);
        }

        const ch: string = this.source[start];
        let token: Token;
        if (isIdentifierStart(ch)) {
            token = this.scanIdentifier();
        }
        else if (isDigit(ch) || (ch === '.' && isDigit(this.source[start + 1] ?? ''))) {
            token = this.scanNumber();
        }
        else if (ch === '"' || ch === '\'') {
            token = this.scanString();
        }
        else if (ch === '`') {
            token = this.scanTemplate(start, '`');
        }
        else if (ch === '/' && !this.jsxTag && this.regexAllowed()) {
            token = this.scanRegex();
        }
        else {
            token = this.scanPunctuator();
        }

        this.prevSignificant = token;
        return token;
    }

    /**
     * Scans raw JSX child text from the current position until the next `<`, `{`, `}`, or EOF.
     * Leading whitespace is preserved (it is significant in HTML). Does not update the
     * regex-detection state.
     * @returns A {@link TokenType.JSX_TEXT} token (possibly empty).
     */
    scanJsxText(): Token {
        const start: number = this.pos;
        let i: number = start;
        while (i < this.source.length) {
            const ch: string = this.source[i];
            if (ch === '<' || ch === '{' || ch === '}') {
                break;
            }
            i++;
        }
        this.pos = i;
        return this.make(TokenType.JSX_TEXT, start, i);
    }

    /**
     * Scans a template continuation starting at the current position, which must point at the
     * `}` that closes a `${...}` substitution. Returns a middle or tail segment.
     * @returns A {@link TokenType.TEMPLATE_MIDDLE} or {@link TokenType.TEMPLATE_TAIL} token.
     */
    scanTemplateContinuation(): Token {
        const token: Token = this.scanTemplate(this.pos, '}');
        this.prevSignificant = token;
        return token;
    }

    private regexAllowed(): boolean {
        const p: Token | undefined = this.prevSignificant;
        if (!p) {
            return true;
        }
        // After a value (number/string/template value/regex) a `/` is division.
        const valueTypes: ReadonlySet<TokenType> = new Set<TokenType>([
            TokenType.NUMBER,
            TokenType.STRING,
            TokenType.TEMPLATE_FULL,
            TokenType.TEMPLATE_TAIL,
            TokenType.REGEX
        ]);
        if (valueTypes.has(p.type)) {
            return false;
        }
        // A plain identifier means division; a keyword (except value keywords) allows a regex.
        if (p.type === TokenType.IDENTIFIER) {
            return KEYWORDS.has(p.value) && !VALUE_KEYWORDS.has(p.value);
        }
        // After a closing `)`/`]` it is division; every other punctuator allows a regex.
        if (p.type === TokenType.PUNCTUATOR) {
            return !(p.value === ')' || p.value === ']');
        }
        return true;
    }

    private skipTrivia(): void {
        while (this.pos < this.source.length) {
            const ch: string = this.source[this.pos];
            if (isWhitespace(ch)) {
                this.pos++;
                continue;
            }
            if (ch === '/' && this.source[this.pos + 1] === '/') {
                this.skipLineComment();
                continue;
            }
            if (ch === '/' && this.source[this.pos + 1] === '*') {
                this.skipBlockComment();
                continue;
            }
            break;
        }
    }

    private skipLineComment(): void {
        this.pos += 2;
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
            this.pos++;
        }
    }

    private skipBlockComment(): void {
        this.pos += 2;
        while (
            this.pos < this.source.length
            && !(this.source[this.pos] === '*' && this.source[this.pos + 1] === '/')
        ) {
            this.pos++;
        }
        this.pos = Math.min(this.pos + 2, this.source.length);
    }

    private scanIdentifier(): Token {
        const start: number = this.pos;
        this.pos++;
        while (this.pos < this.source.length && isIdentifierPart(this.source[this.pos])) {
            this.pos++;
        }
        return this.make(TokenType.IDENTIFIER, start, this.pos);
    }

    // eslint-disable-next-line sonar/cognitive-complexity
    private scanNumber(): Token {
        const start: number = this.pos;
        const ch: string = this.source[this.pos];
        const next: string = this.source[this.pos + 1] ?? '';

        if (ch === '0' && (next === 'x' || next === 'X' || next === 'b' || next === 'B' || next === 'o' || next === 'O')) {
            this.pos += 2;
            while (this.pos < this.source.length && /[\dA-F_a-f]/.test(this.source[this.pos])) {
                this.pos++;
            }
        }
        else {
            while (this.pos < this.source.length && (isDigit(this.source[this.pos]) || this.source[this.pos] === '_')) {
                this.pos++;
            }
            if (this.source[this.pos] === '.') {
                this.pos++;
                while (this.pos < this.source.length && (isDigit(this.source[this.pos]) || this.source[this.pos] === '_')) {
                    this.pos++;
                }
            }
            const e: string = this.source[this.pos] ?? '';
            if (e === 'e' || e === 'E') {
                this.pos++;
                if (this.source[this.pos] === '+' || this.source[this.pos] === '-') {
                    this.pos++;
                }
                while (this.pos < this.source.length && isDigit(this.source[this.pos])) {
                    this.pos++;
                }
            }
        }
        // BigInt suffix
        if (this.source[this.pos] === 'n') {
            this.pos++;
        }
        return this.make(TokenType.NUMBER, start, this.pos);
    }

    private scanString(): Token {
        const start: number = this.pos;
        const quote: string = this.source[this.pos];
        this.pos++;
        while (this.pos < this.source.length) {
            const ch: string = this.source[this.pos];
            if (ch === '\\') {
                this.pos += 2;
                continue;
            }
            if (ch === quote) {
                this.pos++;
                break;
            }
            this.pos++;
        }
        return this.make(TokenType.STRING, start, this.pos);
    }

    /**
     * Scans a template segment. When `open` is '`' it starts a template (full or head);
     * when `open` is '}' it continues one (middle or tail).
     * @param start - Offset of the opening delimiter (backtick or closing brace).
     * @param open - The opening delimiter character.
     * @returns The scanned template token.
     */
    private scanTemplate(start: number, open: '`' | '}'): Token {
        let i: number = start + 1;
        while (i < this.source.length) {
            const ch: string = this.source[i];
            if (ch === '\\') {
                i += 2;
                continue;
            }
            if (ch === '`') {
                this.pos = i + 1;
                return this.make(open === '`' ? TokenType.TEMPLATE_FULL : TokenType.TEMPLATE_TAIL, start, i + 1);
            }
            if (ch === '$' && this.source[i + 1] === '{') {
                this.pos = i + 2;
                return this.make(open === '`' ? TokenType.TEMPLATE_HEAD : TokenType.TEMPLATE_MIDDLE, start, i + 2);
            }
            i++;
        }
        // Unterminated — consume to EOF and treat as full/tail.
        this.pos = this.source.length;
        return this.make(open === '`' ? TokenType.TEMPLATE_FULL : TokenType.TEMPLATE_TAIL, start, this.source.length);
    }

    private scanRegex(): Token {
        const start: number = this.pos;
        this.pos++;
        let inClass: boolean = false;
        while (this.pos < this.source.length) {
            const ch: string = this.source[this.pos];
            if (ch === '\\') {
                this.pos += 2;
                continue;
            }
            if (ch === '[') {
                inClass = true;
            }
            else if (ch === ']') {
                inClass = false;
            }
            else if (ch === '/' && !inClass) {
                this.pos++;
                break;
            }
            else if (ch === '\n') {
                break;
            }
            this.pos++;
        }
        // flags
        while (this.pos < this.source.length && isIdentifierPart(this.source[this.pos])) {
            this.pos++;
        }
        return this.make(TokenType.REGEX, start, this.pos);
    }

    private scanPunctuator(): Token {
        const start: number = this.pos;
        for (const p of PUNCTUATORS) {
            if (this.source.startsWith(p, start)) {
                // `?.` must not swallow the dot of `?.5` (which is `? .5`)
                if (p === '?.' && isDigit(this.source[start + 2] ?? '')) {
                    continue;
                }
                this.pos = start + p.length;
                return this.make(TokenType.PUNCTUATOR, start, this.pos);
            }
        }
        // Unknown single character — emit it so the parser can report a precise error.
        this.pos = start + 1;
        return this.make(TokenType.PUNCTUATOR, start, this.pos);
    }

    private make(type: TokenType, start: number, end: number): Token {
        return { type, value: this.source.slice(start, end), start, end };
    }
}