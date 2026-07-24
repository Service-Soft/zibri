/**
 * The kind of a lexer {@link Token}.
 *
 * JSX text is produced only by the parser-driven `scanJsxText` method, and template
 * middle/tail segments only by `scanTemplateTail`, because both are context-sensitive
 * and cannot be decided by the main scanner alone.
 */
export enum TokenType {
    /**
     * An identifier or keyword (keywords are distinguished by value, not type).
     */
    IDENTIFIER = 'identifier',
    /**
     * A numeric literal, including hex/octal/binary/bigint and numeric separators.
     */
    NUMBER = 'number',
    /**
     * A single- or double-quoted string literal (value includes the quotes).
     */
    STRING = 'string',
    /**
     * A complete template literal with no substitutions, e.g. `abc` (value includes backticks).
     */
    TEMPLATE_FULL = 'template-full',
    /**
     * The opening segment of a template literal up to the first `${`, e.g. `abc${.
     */
    TEMPLATE_HEAD = 'template-head',
    /**
     * A segment between two substitutions, e.g. }abc${.
     */
    TEMPLATE_MIDDLE = 'template-middle',
    /**
     * The closing segment of a template literal after the last substitution, e.g. }abc`.
     */
    TEMPLATE_TAIL = 'template-tail',
    /**
     * A regular expression literal, e.g. /ab+c/gi (value includes the slashes and flags).
     */
    REGEX = 'regex',
    /**
     * A punctuator or operator, e.g. '(', '=>', '===' (value is the exact text).
     */
    PUNCTUATOR = 'punctuator',
    /**
     * Raw JSX text between tags/expressions (produced only by scanJsxText).
     */
    JSX_TEXT = 'jsx-text',
    /**
     * End of input.
     */
    EOF = 'eof'
}

/**
 * A single lexical token with its exact source slice and offset range.
 */
export type Token = {
    /**
     * The kind of token.
     */
    type: TokenType,
    /**
     * The exact source text of the token (for identifiers/punctuators the lexeme; for
     * strings/templates/regex the raw text including delimiters).
     */
    value: string,
    /**
     * Inclusive start offset (0-based) into the source.
     */
    start: number,
    /**
     * Exclusive end offset into the source.
     */
    end: number
};

/**
 * Reserved words of the supported dialect. The lexer still emits them as
 * {@link TokenType.IDENTIFIER}; this set lets the parser recognize them by value.
 */
export const KEYWORDS: ReadonlySet<string> = new Set<string>([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'of',
    'in',
    'import',
    'export',
    'from',
    'as',
    'default',
    'new',
    'typeof',
    'instanceof',
    'void',
    'delete',
    'await',
    'async',
    'yield',
    'this',
    'true',
    'false',
    'null',
    'undefined',
    'class',
    'extends',
    'super',
    'break',
    'continue',
    'switch',
    'case',
    'do',
    'while',
    'throw',
    'try',
    'catch',
    'finally',
    'type',
    'interface',
    'satisfies'
]);