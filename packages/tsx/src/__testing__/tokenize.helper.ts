import { Lexer } from '../lexer/lexer';
import { Token, TokenType } from '../lexer/token.model';

/**
 * Mutable coordination state shared while driving the lexer over template literals.
 */
type TokenizeState = {
    /**
     * Brace depth at which each currently-open template substitution lives.
     */
    templateStack: number[],
    /**
     * The current `{`/`}` nesting depth.
     */
    braceDepth: number
};

/**
 * Whether the given `}` token actually closes a template substitution rather than a block/object.
 * @param token - The token under inspection.
 * @param state - The current coordination state.
 * @returns True if the token closes an open `${...}` substitution.
 */
function closesTemplate(token: Token, state: TokenizeState): boolean {
    return token.type === TokenType.PUNCTUATOR
        && token.value === '}'
        && state.templateStack.length > 0
        && state.templateStack[state.templateStack.length - 1] === state.braceDepth;
}

/**
 * Updates the brace/template coordination state after a normal (non-template-closing) token.
 * @param token - The token just emitted.
 * @param state - The coordination state to mutate.
 */
function trackBraces(token: Token, state: TokenizeState): void {
    if (token.type === TokenType.TEMPLATE_HEAD) {
        state.templateStack.push(state.braceDepth);
    }
    else if (token.type === TokenType.PUNCTUATOR && token.value === '{') {
        state.braceDepth++;
    }
    else if (token.type === TokenType.PUNCTUATOR && token.value === '}') {
        state.braceDepth = Math.max(0, state.braceDepth - 1);
    }
}

/**
 * Drives the {@link Lexer} over a full code string and returns every token including the
 * trailing EOF. Reproduces the coordination the parser performs for template literals: when a
 * `}` closes a `${...}` substitution it is re-scanned as a template middle/tail segment rather
 * than a punctuator. This lets the lexer be exercised end-to-end in isolation.
 * @param source - The source string to tokenize.
 * @returns All tokens, ending with an EOF token.
 */
export function tokenizeAll(source: string): Token[] {
    const lexer: Lexer = new Lexer(source);
    const out: Token[] = [];
    const state: TokenizeState = { templateStack: [], braceDepth: 0 };

    while (true) {
        const token: Token = lexer.next();

        if (token.type === TokenType.EOF) {
            out.push(token);
            break;
        }

        if (closesTemplate(token, state)) {
            lexer.reset({ pos: token.start, prev: undefined });
            const cont: Token = lexer.scanTemplateContinuation();
            out.push(cont);
            state.templateStack.pop();
            if (cont.type === TokenType.TEMPLATE_MIDDLE) {
                state.templateStack.push(state.braceDepth);
            }
            continue;
        }

        out.push(token);
        trackBraces(token, state);
    }
    return out;
}

/**
 * Convenience view of a token as a `[type, value]` tuple, for compact test assertions.
 * @param token - The token to project.
 * @returns A tuple of the token type and its raw value.
 */
export function tokenTuple(token: Token): [TokenType, string] {
    return [token.type, token.value];
}

/**
 * Tokenizes and projects to `[type, value]` tuples, dropping the trailing EOF.
 * @param source - The source string to tokenize.
 * @returns The token tuples without the EOF token.
 */
export function tokenTuples(source: string): [TokenType, string][] {
    return tokenizeAll(source)
        .filter(t => t.type !== TokenType.EOF)
        .map(tokenTuple);
}