/**
 * Normalizes raw JSX text using JSX's whitespace rules: lines are trimmed where they meet a
 * newline, blank lines are dropped, and remaining lines are joined with a single space. Leading and
 * trailing whitespace that is not adjacent to a newline is preserved.
 * @param raw - The raw JSX text.
 * @returns The normalized text (empty when the text is only whitespace across newlines).
 */
export function normalizeJsxText(raw: string): string {
    const lines: string[] = raw.split(/\r\n|\r|\n/);
    let result: string = '';
    for (let i: number = 0; i < lines.length; i++) {
        let line: string = lines[i];
        if (i > 0) {
            line = line.replace(/^[\t ]+/, '');
        }
        if (i < lines.length - 1) {
            line = line.replace(/[\t ]+$/, '');
        }
        if (!line) {
            continue;
        }
        result += result ? ` ${line}` : line;
    }
    return result;
}