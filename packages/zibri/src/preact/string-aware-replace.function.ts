/**
 * Applies a regex replacement to the given text, skipping string literals and comments.
 * Prevents accidental renaming of identifiers that appear inside strings or comments.
 * @param text - The text to apply the replacement to.
 * @param pattern - The pattern to match. Must have the global flag set.
 * @param replacement - The replacement string.
 * @returns The text with replacements applied.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export function stringAwareReplace(text: string, pattern: RegExp, replacement: string | ((...args: string[]) => string)): string {
    let result: string = '';
    let i: number = 0;

    while (i < text.length) {
        // Skip normal string literals (single/double quoted)
        if (text[i] === '"' || text[i] === '\'') {
            const quote: string = text[i];
            const end: number = findStringEnd(text, i, quote);
            result += text.slice(i, end);
            i = end;
            continue;
        }

        // Handle template literals specially: keep literal parts, but process ${...} expressions
        if (text[i] === '`') {
            // append opening backtick
            result += '`';
            i++; // move past `
            while (i < text.length) {
                // escape sequences inside template (preserve as-is)
                if (text[i] === '\\') {
                    // copy escaped char and the next char
                    result += text.slice(i, i + 2);
                    i += 2;
                    continue;
                }

                // found expression start
                if (text[i] === '$' && text[i + 1] === '{') {
                    result += '${';
                    i += 2; // skip ${
                    // find matching closing brace for this expression
                    let depth: number = 1;
                    const exprStart: number = i;
                    while (i < text.length && depth > 0) {
                        const ch: string = text[i];
                        if (ch === '\'' || ch === '"' || ch === '`') {
                            // we need to skip nested strings inside the expression properly
                            const endStr: number = findStringEnd(text, i, ch);
                            i = endStr;
                            continue;
                        }
                        if (ch === '{') {
                            depth++;
                        }
                        else if (ch === '}') {
                            depth--;
                        }
                        i++;
                    }
                    const exprEnd: number = i - 1; // position of the closing '}' was i-1
                    const expr: string = text.slice(exprStart, exprEnd + 0); // slice expression content
                    // recursively apply replacements inside the expression
                    const replacedExpr: string = stringAwareReplace(expr, pattern, replacement);
                    result += replacedExpr;
                    result += '}';
                    // i already points after the closing brace
                    continue;
                }

                // closing backtick
                if (text[i] === '`') {
                    result += '`';
                    i++;
                    break;
                }

                // otherwise copy literal char
                result += text[i];
                i++;
            }
            continue;
        }

        // Skip line comments
        if (text[i] === '/' && text[i + 1] === '/') {
            const end: number = text.indexOf('\n', i);
            const commentEnd: number = end === -1 ? text.length : end + 1;
            result += text.slice(i, commentEnd);
            i = commentEnd;
            continue;
        }
        // Skip block comments
        if (text[i] === '/' && text[i + 1] === '*') {
            const end: number = text.indexOf('*/', i + 2);
            const commentEnd: number = end === -1 ? text.length : end + 2;
            result += text.slice(i, commentEnd);
            i = commentEnd;
            continue;
        }
        // Process next chunk up to the next string/comment
        const nextSpecial: number = findNextSpecial(text, i);
        const chunk: string = text.slice(i, nextSpecial);
        // eslint-disable-next-line sonar/no-all-duplicated-branches
        result += typeof replacement === 'function'
            ? chunk.replace(pattern, replacement)
            : chunk.replace(pattern, replacement);
        i = nextSpecial;
    }

    return result;
}

// eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
export function findStringEnd(text: string, start: number, quote: string): number {
    let i: number = start + 1;
    while (i < text.length) {
        if (text[i] === '\\') {
            i += 2;
            continue;
        }
        if (text[i] === quote) {
            return i + 1;
        }
        // Template literal expressions ${...} — skip past the expression
        if (quote === '`' && text[i] === '$' && text[i + 1] === '{') {
            i += 2;
            let depth: number = 1;
            while (i < text.length && depth > 0) {
                if (text[i] === '{') {
                    depth++;
                }
                else if (text[i] === '}') {
                    depth--;
                }
                i++;
            }
            continue;
        }
        i++;
    }
    return i;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function findNextSpecial(text: string, start: number): number {
    for (let i: number = start; i < text.length; i++) {
        const ch: string = text[i];
        if (ch === '"' || ch === '\'' || ch === '`') {
            return i;
        }
        if (ch === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
            return i;
        }
    }
    return text.length;
}